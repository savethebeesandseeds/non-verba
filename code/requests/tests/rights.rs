// SPDX-License-Identifier: AGPL-3.0-only
//! Independent debt-unit model checks; PUBLIC TEST KEYS are not needed here.
use nonverba_requests::{encoding, model::*, money::Money, rights};

fn money(value: u64) -> Money {
    Money::new(&value.to_string(), "EUR").unwrap()
}

fn obligation(principal: u64) -> Obligation {
    Obligation {
        id: "milestone:work".into(),
        debtor: Role::Requester,
        creditor: Role::Operator,
        category: "COMPENSATION".into(),
        amount: money(principal),
        basis_agreement_hash: "a".repeat(64),
        certificate_ids: vec!["b".repeat(64)],
        due_conditions: "Synthetic test entitlement.".into(),
        disputed_amount: "0".into(),
        discharged_amount: "0".into(),
        released_amount: "0".into(),
        overlap_amount: "0".into(),
        credit_grants: vec![],
        release_grants: vec![],
        unresolved_balance: principal.to_string(),
    }
}

fn allocation(start: u64, end: u64) -> UnitAllocation {
    UnitAllocation {
        obligation_id: "milestone:work".into(),
        basis_agreement_hash: "a".repeat(64),
        start: start.to_string(),
        end: end.to_string(),
    }
}

fn id(name: &str) -> String {
    encoding::bytes_digest(name.as_bytes())
}

#[test]
fn disjoint_and_overlapping_grants_preserve_exact_units_without_scalar_winners() {
    let mut o = obligation(100);
    rights::grant(&mut o, &id("left"), &[allocation(0, 30)], &money(30), false).unwrap();
    rights::grant(
        &mut o,
        &id("right"),
        &[allocation(50, 80)],
        &money(30),
        false,
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "60");
    assert_eq!(o.unresolved_balance, "40");
    rights::grant(
        &mut o,
        &id("overlap"),
        &[allocation(20, 60)],
        &money(40),
        false,
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "80");
    assert_eq!(o.unresolved_balance, "20");
    assert_eq!(o.credit_grants.len(), 3);
    rights::grant(
        &mut o,
        &id("full"),
        &[allocation(0, 100)],
        &money(100),
        false,
    )
    .unwrap();
    rights::grant(
        &mut o,
        &id("contradiction"),
        &[allocation(0, 40)],
        &money(40),
        false,
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "100");
    assert_eq!(o.unresolved_balance, "0");
}

#[test]
fn payment_and_release_overlap_is_visible_and_counted_once() {
    let mut o = obligation(100);
    rights::grant(
        &mut o,
        &id("payment"),
        &[allocation(0, 60)],
        &money(60),
        false,
    )
    .unwrap();
    rights::grant(
        &mut o,
        &id("release"),
        &[allocation(40, 90)],
        &money(50),
        true,
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "60");
    assert_eq!(o.released_amount, "50");
    assert_eq!(o.overlap_amount, "20");
    assert_eq!(o.unresolved_balance, "10");
}

#[test]
fn reversal_is_exact_grant_scoped_and_duplicate_replay_cannot_restore_or_remove_more() {
    let mut o = obligation(100);
    let first = id("first");
    let other = id("other");
    rights::grant(&mut o, &first, &[allocation(0, 80)], &money(80), false).unwrap();
    rights::grant(&mut o, &other, &[allocation(40, 100)], &money(60), false).unwrap();
    rights::revoke(&mut o, &first, &[allocation(20, 70)], &money(50)).unwrap();
    assert_eq!(o.discharged_amount, "80");
    assert_eq!(o.unresolved_balance, "20");
    let once = encoding::canonical(&o).unwrap();
    rights::revoke(&mut o, &first, &[allocation(20, 70)], &money(50)).unwrap();
    rights::grant(&mut o, &first, &[allocation(0, 80)], &money(80), false).unwrap();
    assert_eq!(encoding::canonical(&o).unwrap(), once);
    rights::revoke(&mut o, &first, &[allocation(60, 80)], &money(20)).unwrap();
    assert_eq!(
        o.discharged_amount, "80",
        "the other grant still covers these exact units"
    );
    rights::revoke(&mut o, &other, &[allocation(40, 100)], &money(60)).unwrap();
    assert_eq!(o.discharged_amount, "20");
    assert_eq!(o.unresolved_balance, "80");
}

#[test]
fn coordinate_and_amount_errors_are_atomic() {
    let original = obligation(100);
    let mut wrong_basis = allocation(0, 10);
    wrong_basis.basis_agreement_hash = "c".repeat(64);
    let mut wrong_obligation = allocation(0, 10);
    wrong_obligation.obligation_id = "protection:fee".into();
    let mut noncanonical = allocation(0, 10);
    noncanonical.start = "00".into();
    for (ranges, amount, release) in [
        (vec![wrong_basis], money(10), false),
        (vec![wrong_obligation], money(10), false),
        (vec![noncanonical], money(10), false),
        (vec![allocation(0, 101)], money(101), false),
        (vec![allocation(10, 10)], money(10), false),
        (
            vec![allocation(20, 30), allocation(0, 10)],
            money(20),
            false,
        ),
        (
            vec![allocation(0, 20), allocation(10, 30)],
            money(40),
            false,
        ),
        (vec![allocation(0, 20)], money(10), false),
        (vec![allocation(0, 10)], money(20), true),
        (vec![], money(0), false),
        (
            vec![allocation(0, 10)],
            Money::new("10", "USD").unwrap(),
            false,
        ),
    ] {
        let mut o = original.clone();
        assert!(rights::grant(&mut o, &id("bad"), &ranges, &amount, release).is_err());
        assert_eq!(
            encoding::canonical(&o).unwrap(),
            encoding::canonical(&original).unwrap()
        );
    }
}

#[test]
fn reversal_cannot_escape_its_named_certificate_or_principal() {
    let mut o = obligation(100);
    let grant = id("specific");
    rights::grant(&mut o, &grant, &[allocation(20, 80)], &money(60), false).unwrap();
    for (target, ranges, amount) in [
        (id("absent"), vec![allocation(20, 30)], money(10)),
        (grant.clone(), vec![allocation(10, 30)], money(20)),
        (grant.clone(), vec![allocation(70, 90)], money(20)),
        (grant.clone(), vec![allocation(20, 30)], money(20)),
    ] {
        let before = encoding::canonical(&o).unwrap();
        assert!(rights::revoke(&mut o, &target, &ranges, &amount).is_err());
        assert_eq!(encoding::canonical(&o).unwrap(), before);
    }
}

#[test]
fn excess_receipt_and_duplicate_grant_do_not_invent_extra_discharge() {
    let mut o = obligation(100);
    let grant = id("excess");
    rights::grant(&mut o, &grant, &[allocation(0, 60)], &money(80), false).unwrap();
    rights::grant(&mut o, &id("unallocated"), &[], &money(10), false).unwrap();
    rights::grant(&mut o, &grant, &[allocation(0, 60)], &money(80), false).unwrap();
    assert_eq!(o.discharged_amount, "60");
    assert_eq!(o.credit_grants.len(), 2);
    assert!(rights::grant(&mut o, &grant, &[allocation(0, 80)], &money(80), false).is_err());
    assert_eq!(o.discharged_amount, "60");
}

#[test]
fn grants_and_reversals_preserve_holes_in_signed_ranges() {
    let mut o = obligation(100);
    let grant = id("separated-units");
    rights::grant(
        &mut o,
        &grant,
        &[allocation(0, 20), allocation(40, 60), allocation(80, 100)],
        &money(60),
        false,
    )
    .unwrap();
    rights::revoke(
        &mut o,
        &grant,
        &[allocation(10, 20), allocation(40, 50), allocation(90, 100)],
        &money(30),
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "30");
    rights::revoke(
        &mut o,
        &grant,
        &[allocation(15, 20), allocation(45, 60)],
        &money(20),
    )
    .unwrap();
    assert_eq!(o.discharged_amount, "20");
    let before = encoding::canonical(&o).unwrap();
    assert!(rights::revoke(&mut o, &grant, &[allocation(10, 50)], &money(40)).is_err());
    assert_eq!(encoding::canonical(&o).unwrap(), before);
}

#[test]
fn signed_range_limit_does_not_limit_accumulated_authorized_reversals() {
    let mut o = obligation(600);
    let too_many: Vec<_> = (0..=rights::MAX_ALLOCATIONS as u64)
        .map(|index| allocation(index * 2, index * 2 + 1))
        .collect();
    assert!(rights::grant(&mut o, &id("too-many"), &too_many, &money(129), false).is_err());
    assert!(o.credit_grants.is_empty());
    let grant = id("many-corrections");
    rights::grant(&mut o, &grant, &[allocation(0, 600)], &money(600), false).unwrap();
    for index in 0..150 {
        rights::revoke(
            &mut o,
            &grant,
            &[allocation(index * 2, index * 2 + 1)],
            &money(1),
        )
        .unwrap();
    }
    assert_eq!(o.credit_grants[0].revoked.len(), 150);
    assert_eq!(o.discharged_amount, "450");
    assert_eq!(o.unresolved_balance, "150");
}

#[test]
fn maximum_supported_principal_uses_intervals_without_expanding_units() {
    let bound = nonverba_requests::money::MAX_MINOR_UNITS;
    let mut o = obligation(bound);
    rights::grant(
        &mut o,
        &id("huge-payment"),
        &[allocation(0, bound)],
        &money(bound),
        false,
    )
    .unwrap();
    rights::grant(
        &mut o,
        &id("huge-release"),
        &[allocation(1, bound)],
        &money(bound - 1),
        true,
    )
    .unwrap();
    assert_eq!(o.discharged_amount, bound.to_string());
    assert_eq!(o.overlap_amount, (bound - 1).to_string());
    assert_eq!(o.unresolved_balance, "0");
}

#[test]
fn every_small_interval_pair_matches_independent_per_unit_model_in_either_order() {
    for start in 0..8 {
        for end in start + 1..=8 {
            for other_start in 0..8 {
                for other_end in other_start + 1..=8 {
                    let paid: Vec<bool> = (0..8).map(|unit| start <= unit && unit < end).collect();
                    let released: Vec<bool> = (0..8)
                        .map(|unit| other_start <= unit && unit < other_end)
                        .collect();
                    let union = (0..8).filter(|&unit| paid[unit] || released[unit]).count();
                    let overlap = (0..8).filter(|&unit| paid[unit] && released[unit]).count();
                    let mut reports = vec![];
                    for reverse in [false, true] {
                        let mut o = obligation(8);
                        let mut operations = vec![
                            (id("paid"), allocation(start, end), false),
                            (id("released"), allocation(other_start, other_end), true),
                        ];
                        if reverse {
                            operations.reverse();
                        }
                        for (certificate, range, release) in operations {
                            let amount = range.end.parse::<u64>().unwrap()
                                - range.start.parse::<u64>().unwrap();
                            rights::grant(&mut o, &certificate, &[range], &money(amount), release)
                                .unwrap();
                        }
                        assert_eq!(o.discharged_amount, (end - start).to_string());
                        assert_eq!(o.released_amount, (other_end - other_start).to_string());
                        assert_eq!(o.overlap_amount, overlap.to_string());
                        assert_eq!(o.unresolved_balance, (8 - union).to_string());
                        reports.push(encoding::canonical(&o).unwrap());
                    }
                    assert_eq!(reports[0], reports[1]);
                }
            }
        }
    }
}
