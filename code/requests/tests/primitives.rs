// SPDX-License-Identifier: AGPL-3.0-only
use hmac::{Hmac, Mac};
use nonverba_requests::{crypto::*, encoding::*, money::*};
use p256::ecdsa::{
    Signature, SigningKey,
    signature::{Signer, Verifier},
};
use serde::Deserialize;
use serde_json::{Value, json};
use sha2::Sha256;

fn key() -> SigningKey {
    SigningKey::from_slice(&[1u8; 32]).unwrap()
}
fn claims() -> SignatureClaims {
    SignatureClaims {
        protocol_version: "1".into(),
        deployment_domain: "nonverba.local/test".into(),
        assignment_id: "assignment-1".into(),
        content_hash: bytes_digest(b"exact agreement"),
        role: "O".into(),
        key_id: "key-o".into(),
        purpose: "AGREEMENT".into(),
    }
}
fn context() -> CommitmentContext {
    CommitmentContext {
        deployment_domain: "nonverba.local/test".into(),
        assignment_id: "assignment-1".into(),
        agreement_hash: bytes_digest(b"agreement"),
        dispute_id: "dispute-1".into(),
        round_id: "round-1".into(),
        author_role: "O".into(),
        manifest_digest: bytes_digest(b"secret manifest"),
    }
}

#[test]
fn rfc8785_number_serialization_and_utf16_order() {
    // RFC 8785 §3.2.2/3.2.3 vectors. UTF-16 order differs from UTF-8 order.
    let numbers: Value =
        serde_json::from_str("[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001]")
            .unwrap();
    assert_eq!(
        String::from_utf8(canonical(&numbers).unwrap()).unwrap(),
        "[333333333.3333333,1e+30,4.5,0.002,1e-27]"
    );
    let names = json!({"\u{20ac}":"Euro Sign", "\r":"Carriage Return", "\u{fb33}":"Hebrew Letter Dalet With Dagesh", "1":"One", "\u{1f600}":"Emoji: Grinning Face", "\u{80}":"Control", "\u{f6}":"Latin Small Letter O With Diaeresis"});
    let serialized = String::from_utf8(canonical(&names).unwrap()).unwrap();
    let expected = "{\"\\r\":\"Carriage Return\",\"1\":\"One\",\"\u{80}\":\"Control\",\"ö\":\"Latin Small Letter O With Diaeresis\",\"€\":\"Euro Sign\",\"😀\":\"Emoji: Grinning Face\",\"דּ\":\"Hebrew Letter Dalet With Dagesh\"}";
    assert_eq!(serialized, expected);
    assert_eq!(canonical(&-0.0f64).unwrap(), b"0");
    assert_ne!(
        digest("é").unwrap(),
        digest("e\u{301}").unwrap(),
        "signed text must not be normalized"
    );
    assert!(
        canonical(&[0.0, f64::NAN])
            .unwrap_err()
            .starts_with("JSON_NUMBER:")
    );
    assert!(canonical(&json!({"nested": [MAX_SAFE_INTEGER + 1]})).is_err());
    let mut nested = json!(0);
    for _ in 0..MAX_JSON_DEPTH + 1 {
        nested = Value::Array(vec![nested]);
    }
    assert!(canonical(&nested).unwrap_err().starts_with("JSON_DEPTH:"));
}

#[test]
fn strict_json_rejects_duplicate_unknown_oversized_and_malformed_values() {
    for raw in [r#"{"x":1,"x":2}"#, r#"{"outer":[{"x":1,"\u0078":2}]}"#] {
        assert!(
            strict_parse::<Value>(raw.as_bytes())
                .unwrap_err()
                .starts_with("JSON_DUPLICATE:")
        );
    }
    #[derive(Debug, Deserialize)]
    #[serde(deny_unknown_fields)]
    struct Closed {
        x: u8,
    }
    assert_eq!(strict_parse::<Closed>(br#"{"x":1}"#).unwrap().x, 1);
    for raw in [r#"{"x":1,"alg":"none"}"#, r#"{"x":1.0}"#, r#"{"x":256}"#] {
        assert!(strict_parse::<Closed>(raw.as_bytes()).is_err());
    }
    for raw in [
        r#""\ud800""#,
        "NaN",
        "1e400",
        "9007199254740992",
        "18446744073709551616",
        "{}{}",
    ] {
        assert!(strict_parse::<Value>(raw.as_bytes()).is_err(), "{raw}");
    }
    assert!(strict_parse::<Value>(&[0xff]).is_err());
    assert!(
        strict_parse::<Value>(&vec![b' '; MAX_JSON_BYTES + 1])
            .unwrap_err()
            .starts_with("JSON_SIZE:")
    );
    let nested = format!(
        "{}0{}",
        "[".repeat(MAX_JSON_DEPTH + 2),
        "]".repeat(MAX_JSON_DEPTH + 2)
    );
    assert!(
        strict_parse::<Value>(nested.as_bytes())
            .unwrap_err()
            .starts_with("JSON_DEPTH:")
    );
}

#[test]
fn decimal_money_is_bounded_and_currency_typed() {
    for malformed in [
        "",
        "00",
        "01",
        "+1",
        "-1",
        "1.0",
        "1e2",
        " 1",
        "1 ",
        "١",
        "9007199254740992",
    ] {
        assert!(Money::new(malformed, "EUR").is_err(), "{malformed}");
    }
    let max = Money::new(&MAX_MINOR_UNITS.to_string(), "USD").unwrap();
    assert!(max.checked_add(&Money::new("1", "USD").unwrap()).is_err());
    let zero = Money::new("0", "JPY").unwrap();
    assert!(zero.checked_sub(&Money::new("1", "JPY").unwrap()).is_err());
    assert!(
        Money::new("1", "EUR")
            .unwrap()
            .checked_add(&Money::new("1", "USD").unwrap())
            .is_err()
    );
    assert!(Money::new("1", "usd").is_err());
    assert!(Money::new("1", "ABC").is_err());
    assert_eq!(
        Money::new("100", "EUR")
            .unwrap()
            .checked_sub(&Money::new("25", "EUR").unwrap())
            .unwrap(),
        Money::new("75", "EUR").unwrap()
    );
    for invalid in [
        br#"{"minor_units":"1","currency":"JPY","exponent":2}"#.as_slice(),
        br#"{"minor_units":1,"currency":"EUR","exponent":2}"#,
        br#"{"minor_units":"1.5","currency":"EUR","exponent":2}"#,
    ] {
        assert!(strict_parse::<Money>(invalid).is_err());
    }
    for currency in ["USD", "EUR", "NOK", "JPY", "KWD"] {
        Money::new("1", currency).unwrap().validate().unwrap();
    }
}

#[test]
fn rfc6979_p256_sha256_sample_vector() {
    // RFC 6979 A.2.5, also in the upstream p256 test suite.
    let key = SigningKey::from_slice(
        &hex::decode("c9afa9d845ba75166b5c215767b1d6934e50c3db36e89b127b8a622b120f6721").unwrap(),
    )
    .unwrap();
    let expected = hex::decode(concat!(
        "efd48b2aacb6a8fd1140dd9cd45e81d69d2c877b56aaf991c34d0ea84eaf3716",
        "f7cb1c942d657c41d436c7a1b6e29f65f3e900dbb9aff4064dc4ab2f843acda8"
    ))
    .unwrap();
    let actual: Signature = key.sign(b"sample");
    assert_eq!(actual.to_bytes().as_slice(), expected);
    key.verifying_key().verify(b"sample", &actual).unwrap();
    assert!(key.verifying_key().verify(b"not sample", &actual).is_err());
}

#[test]
fn signatures_pin_every_context_and_authority_field() {
    let key = key();
    let original = claims();
    let binding = key_binding("O", "key-o", &key);
    let signed = sign(&original, &key).unwrap();
    verify(&signed, &original, &binding).unwrap();
    assert_eq!(decode_base64url(&signed.signature, 64).unwrap().len(), 64);
    for field in 0..7 {
        let mut changed = original.clone();
        match field {
            0 => changed.protocol_version = "2".into(),
            1 => changed.deployment_domain = "other.domain".into(),
            2 => changed.assignment_id = "assignment-2".into(),
            3 => changed.content_hash = bytes_digest(b"other terms"),
            4 => changed.role = "R".into(),
            5 => changed.key_id = "key-r".into(),
            6 => changed.purpose = "PAYMENT_RECEIPT".into(),
            _ => unreachable!(),
        }
        assert!(verify(&signed, &changed, &binding).is_err());
        let mut substituted = signed.clone();
        substituted.claims = changed.clone();
        assert!(verify(&substituted, &changed, &binding).is_err());
    }
    let unrelated = key_binding("O", "key-o", &SigningKey::from_slice(&[2u8; 32]).unwrap());
    assert!(verify(&signed, &original, &unrelated).is_err());
    let mut invalid = signed.clone();
    invalid.signature.push('=');
    assert!(verify(&invalid, &original, &binding).is_err());
    let low = Signature::from_slice(&decode_base64url(&signed.signature, 64).unwrap()).unwrap();
    let high_s = -*low.s();
    let high = Signature::from_scalars(low.r().to_bytes(), high_s.to_bytes()).unwrap();
    let mut malleated = signed.clone();
    malleated.signature = encode_base64url(&high.to_bytes());
    assert!(
        verify(&malleated, &original, &binding)
            .unwrap_err()
            .starts_with("SIGNATURE_ENCODING:")
    );
    let mut unknown_algorithm = serde_json::to_value(&signed).unwrap();
    unknown_algorithm["alg"] = json!("none");
    assert!(
        strict_parse::<DetachedSignature>(&serde_json::to_vec(&unknown_algorithm).unwrap())
            .is_err()
    );
}

#[test]
fn commitments_open_only_for_exact_context_and_secret() {
    let original = context();
    let salt = [7u8; 32];
    let committed = commitment(&original, &salt).unwrap();
    verify_commitment(&original, &salt, &committed).unwrap();
    assert!(verify_commitment(&original, &[8u8; 32], &committed).is_err());
    for field in 0..7 {
        let mut changed = original.clone();
        match field {
            0 => changed.deployment_domain = "different.domain".into(),
            1 => changed.assignment_id = "assignment-2".into(),
            2 => changed.agreement_hash = bytes_digest(b"other agreement"),
            3 => changed.dispute_id = "dispute-2".into(),
            4 => changed.round_id = "round-2".into(),
            5 => changed.author_role = "R".into(),
            6 => changed.manifest_digest = bytes_digest(b"changed file"),
            _ => unreachable!(),
        }
        assert!(verify_commitment(&changed, &salt, &committed).is_err());
    }
    let first = fresh_salt().unwrap();
    let second = fresh_salt().unwrap();
    assert_ne!(first, second);
    assert_eq!(
        decode_base64url(&encode_base64url(&first), 32).unwrap(),
        first
    );
}

#[test]
fn rfc4231_hmac_sha256_test_case_1() {
    let mut mac = Hmac::<Sha256>::new_from_slice(&[0x0b; 20]).unwrap();
    mac.update(b"Hi There");
    assert_eq!(
        hex::encode(mac.finalize().into_bytes()),
        "b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7"
    );
}

#[test]
#[ignore = "requires Node.js; run with cargo test --test primitives -- --include-ignored"]
fn independent_node_runtime_verifies_rust_bytes_signature_and_hmac() {
    use std::{
        io::Write,
        process::{Command, Stdio},
    };
    let key = key();
    let claims = claims();
    let signature = sign(&claims, &key).unwrap();
    let point = key.verifying_key().to_encoded_point(false);
    let canonical_input =
        json!({"\u{e000}": 1, "\u{1f600}": 2, "fraction": 0.002, "negative_zero": -0.0});
    let context = context();
    let salt = [7u8; 32];
    let fixture = json!({
        "jcs_input": canonical_input, "jcs_expected": String::from_utf8(canonical(&canonical_input).unwrap()).unwrap(),
        "signing_bytes": String::from_utf8(signing_bytes(&claims).unwrap()).unwrap(), "signature": signature.signature,
        "x": encode_base64url(point.x().unwrap()), "y": encode_base64url(point.y().unwrap()),
        "commitment_message": String::from_utf8(commitment_message(&context).unwrap()).unwrap(),
        "salt": encode_base64url(&salt), "commitment": commitment(&context, &salt).unwrap(),
    });
    // This tiny independent ECMAScript oracle is test-only; production JCS is
    // exclusively the pinned Rust crate. ECMAScript .sort() orders UTF-16 units.
    let script = r#"
        const crypto = require('node:crypto');
        let text=''; process.stdin.setEncoding('utf8'); process.stdin.on('data',c=>text+=c);
        process.stdin.on('end',()=>{
          const v=JSON.parse(text);
          function jcs(x){ if(Array.isArray(x))return '['+x.map(jcs).join(',')+']';
            if(x && typeof x==='object')return '{'+Object.keys(x).sort().map(k=>JSON.stringify(k)+':'+jcs(x[k])).join(',')+'}';
            return JSON.stringify(x); }
          if(jcs(v.jcs_input)!==v.jcs_expected)throw Error('JCS mismatch');
          const key=crypto.createPublicKey({key:{kty:'EC',crv:'P-256',x:v.x,y:v.y},format:'jwk'});
          if(!crypto.verify('sha256',Buffer.from(v.signing_bytes),{key,dsaEncoding:'ieee-p1363'},Buffer.from(v.signature,'base64url')))throw Error('signature mismatch');
          const actual=crypto.createHmac('sha256',Buffer.from(v.salt,'base64url')).update(v.commitment_message).digest('hex');
          if(actual!==v.commitment)throw Error('HMAC mismatch');
        });
    "#;
    let mut child = Command::new(std::env::var("NODE_BINARY").unwrap_or_else(|_| "node".into()))
        .args(["-e", script])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("Node.js required for this explicit interoperability test");
    child
        .stdin
        .take()
        .unwrap()
        .write_all(&serde_json::to_vec(&fixture).unwrap())
        .unwrap();
    let output = child.wait_with_output().unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}
