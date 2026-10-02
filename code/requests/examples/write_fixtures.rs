// SPDX-License-Identifier: AGPL-3.0-only
//! Generate deterministic synthetic protocol vectors using PUBLIC TEST KEYS.
//! No identities are authenticated outside the fixture, no work is performed,
//! and no payment, protection, or external verification is executed.

#[path = "../tests/common/mod.rs"]
mod common;

use common::*;
use nonverba_requests::{bundle::verify_assignment_bundle, model::*};
use serde::Serialize;
use std::{fs, path::Path};

fn save(path: &Path, value: &impl Serialize) -> Result<(), Box<dyn std::error::Error>> {
    let mut bytes = serde_json::to_vec_pretty(value)?;
    bytes.push(b'\n');
    fs::write(path, bytes)?;
    Ok(())
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let folder = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("fixtures");
    fs::create_dir_all(&folder)?;
    let (mut bundle, trust, keys) = fixture();
    let bound = verify_assignment_bundle(&bundle, &trust)?;
    if !bound.agreement.bound || !bound.ready_to_start {
        return Err("synthetic root fixture failed independent verification".into());
    }
    save(&folder.join("agreement-bound.json"), &bundle)?;
    save(&folder.join("trust.json"), &trust)?;

    let entitlement = establish_compensation(&mut bundle, &keys);
    let receipt = sign_action(
        &bundle,
        &keys,
        Action::PaymentReceipt {
            payment_id: "synthetic-payment-1".into(),
            obligation_id: "milestone:work".into(),
            amount: money("10000"),
            rail_reference: "SYNTHETIC TEST PAYEE RECEIPT - no funds moved".into(),
        },
        &[Role::Operator],
        &[entitlement],
        "synthetic-payee-receipt",
    );
    bundle.actions.push(receipt);
    let report = verify_assignment_bundle(&bundle, &trust)?;
    let work = report
        .obligations
        .iter()
        .find(|item| item.id == "milestone:work")
        .ok_or("fixture entitlement not established")?;
    if work.discharged_amount != "10000" || work.unresolved_balance != "0" {
        return Err("synthetic receipt fixture failed verification".into());
    }
    save(&folder.join("lifecycle-bundle.json"), &bundle)?;
    save(&folder.join("lifecycle-report.json"), &report)?;
    println!(
        "Wrote public synthetic test vectors to {}. PUBLIC TEST KEYS; no funds moved.",
        folder.display()
    );
    Ok(())
}
