// SPDX-License-Identifier: AGPL-3.0-only
//! Policy-2 debt-unit grants. Authorization is checked by the caller; this module
//! validates immutable coordinates and projects their explicitly signed coverage.
//! Contradictory bookkeeping assertions never subtract another certificate's grant.

use crate::{
    encoding,
    model::{Obligation, UnitAllocation, UnitGrant},
    money::{Money, parse_minor_units},
};
use std::collections::BTreeSet;

type Range = (u64, u64);
pub const MAX_ALLOCATIONS: usize = 128;

fn ranges(o: &Obligation, allocations: &[UnitAllocation]) -> Result<Vec<Range>, String> {
    let principal = o.amount.validate()?;
    let mut result = Vec::with_capacity(allocations.len());
    let mut previous_end = 0;
    for (index, allocation) in allocations.iter().enumerate() {
        if allocation.obligation_id != o.id
            || allocation.basis_agreement_hash != o.basis_agreement_hash
        {
            return Err("ALLOCATION_BINDING: allocation must name this obligation and its immutable Agreement basis".into());
        }
        encoding::validate_digest(&allocation.basis_agreement_hash)?;
        let start = parse_minor_units(&allocation.start)?;
        let end = parse_minor_units(&allocation.end)?;
        if start >= end || end > principal {
            return Err(
                "ALLOCATION_BOUNDS: require 0 <= start < end <= obligation principal".into(),
            );
        }
        if index > 0 && start < previous_end {
            return Err("ALLOCATION_ORDER: ranges must be sorted and nonoverlapping".into());
        }
        result.push((start, end));
        previous_end = end;
    }
    Ok(result)
}

fn measure(ranges: &[Range]) -> u64 {
    // Valid ranges are disjoint subsets of one bounded principal.
    ranges.iter().map(|(start, end)| end - start).sum()
}

fn union(mut ranges: Vec<Range>) -> Vec<Range> {
    ranges.sort_unstable();
    let mut result: Vec<Range> = vec![];
    for (start, end) in ranges {
        if let Some(last) = result.last_mut()
            && start <= last.1
        {
            last.1 = last.1.max(end);
        } else {
            result.push((start, end));
        }
    }
    result
}

fn subtract(source: &[Range], removed: &[Range]) -> Vec<Range> {
    let mut result = vec![];
    for &(start, end) in source {
        let mut cursor = start;
        for &(cut_start, cut_end) in removed {
            if cut_end <= cursor {
                continue;
            }
            if cut_start >= end {
                break;
            }
            if cut_start > cursor {
                result.push((cursor, cut_start.min(end)));
            }
            cursor = cursor.max(cut_end);
            if cursor >= end {
                break;
            }
        }
        if cursor < end {
            result.push((cursor, end));
        }
    }
    result
}

fn allocations(o: &Obligation, ranges: &[Range]) -> Vec<UnitAllocation> {
    ranges
        .iter()
        .map(|(start, end)| UnitAllocation {
            obligation_id: o.id.clone(),
            basis_agreement_hash: o.basis_agreement_hash.clone(),
            start: start.to_string(),
            end: end.to_string(),
        })
        .collect()
}

/// Exact coverage named in these allocations, after coordinate validation.
pub fn allocation_amount(o: &Obligation, allocations: &[UnitAllocation]) -> Result<u64, String> {
    if allocations.len() > MAX_ALLOCATIONS {
        return Err("ALLOCATION_LIMIT: too many signed allocation ranges".into());
    }
    Ok(measure(&ranges(o, allocations)?))
}

fn amount(o: &Obligation, money: &Money) -> Result<u64, String> {
    let amount = money.validate()?;
    o.amount.validate()?;
    if money.currency != o.amount.currency || money.exponent != o.amount.exponent {
        return Err(
            "MONEY_MISMATCH: grant amount and obligation must use the same currency and exponent"
                .into(),
        );
    }
    if amount == 0 {
        return Err("ALLOCATION_AMOUNT: a grant or reversal must state a positive amount".into());
    }
    Ok(amount)
}

/// Record one authenticated creditor discharge or authorized bilateral release.
/// A receipt may describe excess funds without assigning them to this principal.
pub fn grant(
    o: &mut Obligation,
    id: &str,
    signed_allocations: &[UnitAllocation],
    signed_amount: &Money,
    release: bool,
) -> Result<(), String> {
    encoding::validate_digest(id)?;
    let value = amount(o, signed_amount)?;
    let covered = allocation_amount(o, signed_allocations)?;
    if (release && covered != value) || (!release && covered > value) {
        return Err("ALLOCATION_AMOUNT: release coverage must equal its amount; receipt coverage cannot exceed its amount".into());
    }
    let same_kind = if release {
        &o.release_grants
    } else {
        &o.credit_grants
    };
    let other_kind = if release {
        &o.credit_grants
    } else {
        &o.release_grants
    };
    if other_kind.iter().any(|grant| grant.certificate_id == id) {
        return Err("GRANT_ID: one certificate cannot represent different effect kinds".into());
    }
    if let Some(existing) = same_kind.iter().find(|grant| grant.certificate_id == id) {
        if existing.allocations != signed_allocations {
            return Err("GRANT_ID: one certificate cannot represent different allocations".into());
        }
        // A duplicate cannot restore ranges already revoked from this grant.
        return refresh(o);
    }
    let mut candidate = o.clone();
    let grants = if release {
        &mut candidate.release_grants
    } else {
        &mut candidate.credit_grants
    };
    grants.push(UnitGrant {
        certificate_id: id.into(),
        allocations: signed_allocations.to_vec(),
        revoked: vec![],
    });
    refresh(&mut candidate)?;
    *o = candidate;
    Ok(())
}

/// Apply an independently authorized reversal to only its named receipt grant.
/// Repeated or overlapping reversal certificates cannot revoke the same unit twice.
pub fn revoke(
    o: &mut Obligation,
    target_grant: &str,
    signed_allocations: &[UnitAllocation],
    signed_amount: &Money,
) -> Result<(), String> {
    encoding::validate_digest(target_grant)?;
    let value = amount(o, signed_amount)?;
    let covered = allocation_amount(o, signed_allocations)?;
    let requested = ranges(o, signed_allocations)?;
    if covered != value {
        return Err("ALLOCATION_AMOUNT: reversal coverage must equal its signed amount".into());
    }
    let index = o
        .credit_grants
        .iter()
        .position(|grant| grant.certificate_id == target_grant)
        .ok_or_else(|| {
            "REVERSAL_GRANT: exact target receipt grant is not established".to_string()
        })?;
    let granted = ranges(o, &o.credit_grants[index].allocations)?;
    if !subtract(&requested, &granted).is_empty() {
        return Err("REVERSAL_BOUNDS: reversal names units outside its exact target grant".into());
    }
    let mut revoked = ranges(o, &o.credit_grants[index].revoked)?;
    revoked.extend(requested);
    let revoked = allocations(o, &union(revoked));
    let mut candidate = o.clone();
    candidate.credit_grants[index].revoked = revoked;
    refresh(&mut candidate)?;
    *o = candidate;
    Ok(())
}

fn active(
    o: &Obligation,
    grants: &[UnitGrant],
    ids: &mut BTreeSet<String>,
) -> Result<Vec<Range>, String> {
    let mut result = vec![];
    for grant in grants {
        encoding::validate_digest(&grant.certificate_id)?;
        if !ids.insert(grant.certificate_id.clone()) {
            return Err("GRANT_ID: repeated certificate in financial projection".into());
        }
        let granted = ranges(o, &grant.allocations)?;
        let revoked = ranges(o, &grant.revoked)?;
        if !subtract(&revoked, &granted).is_empty() {
            return Err("REVERSAL_BOUNDS: revoked units lie outside their target grant".into());
        }
        result.extend(subtract(&granted, &revoked));
    }
    Ok(union(result))
}

/// Recompute exact coverage, preserving the separate sources and their overlap.
pub fn refresh(o: &mut Obligation) -> Result<(), String> {
    let principal = o.amount.validate()?;
    let mut ids = BTreeSet::new();
    let paid = active(o, &o.credit_grants, &mut ids)?;
    let released = active(o, &o.release_grants, &mut ids)?;
    let paid_amount = measure(&paid);
    let released_amount = measure(&released);
    let combined = measure(&union(paid.into_iter().chain(released).collect()));
    o.discharged_amount = paid_amount.to_string();
    o.released_amount = released_amount.to_string();
    o.overlap_amount = (paid_amount + released_amount - combined).to_string();
    o.unresolved_balance = (principal - combined).to_string();
    o.credit_grants
        .sort_by(|left, right| left.certificate_id.cmp(&right.certificate_id));
    o.release_grants
        .sort_by(|left, right| left.certificate_id.cmp(&right.certificate_id));
    Ok(())
}
