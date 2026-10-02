// SPDX-License-Identifier: AGPL-3.0-only
//! Strict JSON admission and RFC 8785 canonical bytes.
//!
//! Protocol identifiers are ASCII; signed prose is exact Unicode with no
//! normalization. Integers outside the interoperable safe range use strings.

use serde::{
    Serialize,
    de::{DeserializeOwned, DeserializeSeed, MapAccess, SeqAccess, Visitor},
};
use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, fmt};

pub const MAX_JSON_BYTES: usize = 4 * 1024 * 1024;
pub const MAX_JSON_DEPTH: usize = 64;
pub const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

/// Admit bytes before typed deserialization. Duplicate names are rejected even
/// inside fields the eventual type would otherwise ignore. Schemas must also
/// use `deny_unknown_fields` to close their field set.
pub fn strict_parse<T: DeserializeOwned>(bytes: &[u8]) -> Result<T, String> {
    if bytes.is_empty() || bytes.len() > MAX_JSON_BYTES {
        return Err("JSON_SIZE: JSON must contain 1..4194304 bytes".into());
    }
    let mut de = serde_json::Deserializer::from_slice(bytes);
    let value = StrictValue { depth: 0 }
        .deserialize(&mut de)
        .map_err(json_error)?;
    de.end().map_err(json_error)?;
    serde_json::from_value(value).map_err(|e| format!("SCHEMA: {e}"))
}

fn json_error(error: serde_json::Error) -> String {
    let detail = error.to_string();
    if detail.starts_with("JSON_") {
        detail
    } else {
        format!("JSON_INVALID: {detail}")
    }
}

struct StrictValue {
    depth: usize,
}

impl<'de> DeserializeSeed<'de> for StrictValue {
    type Value = Value;
    fn deserialize<D: serde::Deserializer<'de>>(self, deserializer: D) -> Result<Value, D::Error> {
        if self.depth > MAX_JSON_DEPTH {
            return Err(serde::de::Error::custom(
                "JSON_DEPTH: nesting limit exceeded",
            ));
        }
        deserializer.deserialize_any(self)
    }
}

impl<'de> Visitor<'de> for StrictValue {
    type Value = Value;
    fn expecting(&self, formatter: &mut fmt::Formatter) -> fmt::Result {
        formatter.write_str("strict JSON")
    }
    fn visit_bool<E>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_unit<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_none<E>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::String(value.into()))
    }
    fn visit_string<E>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(value))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Value, E> {
        if value.unsigned_abs() > MAX_SAFE_INTEGER {
            return Err(E::custom(
                "JSON_NUMBER: integer must use a decimal string outside the safe range",
            ));
        }
        Ok(Value::Number(value.into()))
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Value, E> {
        if value > MAX_SAFE_INTEGER {
            return Err(E::custom(
                "JSON_NUMBER: integer must use a decimal string outside the safe range",
            ));
        }
        Ok(Value::Number(value.into()))
    }
    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Value, E> {
        if value.fract() == 0.0 && value.abs() > MAX_SAFE_INTEGER as f64 {
            return Err(E::custom(
                "JSON_NUMBER: integral value exceeds the safe range",
            ));
        }
        Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("JSON_NUMBER: nonfinite number"))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = seq.next_element_seed(StrictValue {
            depth: self.depth + 1,
        })? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut names = HashSet::new();
        let mut values = Map::new();
        while let Some(name) = map.next_key::<String>()? {
            if !names.insert(name.clone()) {
                return Err(serde::de::Error::custom(
                    "JSON_DUPLICATE: duplicate object member",
                ));
            }
            values.insert(
                name,
                map.next_value_seed(StrictValue {
                    depth: self.depth + 1,
                })?,
            );
        }
        Ok(Value::Object(values))
    }
}

/// Use the pinned RFC 8785 implementation; do not substitute serde_json key
/// ordering, which differs from UTF-16 ordering for supplementary characters.
pub fn canonical<T: Serialize + ?Sized>(value: &T) -> Result<Vec<u8>, String> {
    value.serialize(NumberCheck { depth: 0 }).map_err(|e| {
        if e.to_string().starts_with("JSON_DEPTH:") {
            e.to_string()
        } else {
            format!("JSON_NUMBER: {e}")
        }
    })?;
    let value = serde_json::to_value(value).map_err(|e| format!("JSON_INVALID: {e}"))?;
    check_depth(&value, 0)?;
    let bytes = serde_jcs::to_vec(&value).map_err(|e| format!("JSON_CANONICAL: {e}"))?;
    if bytes.len() > MAX_JSON_BYTES {
        return Err("JSON_SIZE: canonical object exceeds the byte limit".into());
    }
    Ok(bytes)
}

fn check_depth(value: &Value, depth: usize) -> Result<(), String> {
    if depth > MAX_JSON_DEPTH {
        return Err("JSON_DEPTH: nesting limit exceeded".into());
    }
    match value {
        Value::Array(values) => {
            for value in values {
                check_depth(value, depth + 1)?;
            }
        }
        Value::Object(values) => {
            for value in values.values() {
                check_depth(value, depth + 1)?;
            }
        }
        _ => (),
    }
    Ok(())
}

pub fn digest<T: Serialize + ?Sized>(value: &T) -> Result<String, String> {
    Ok(bytes_digest(&canonical(value)?))
}
pub fn bytes_digest(bytes: &[u8]) -> String {
    hex::encode(Sha256::digest(bytes))
}

pub fn validate_id(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 128
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:-".contains(&b))
    {
        return Err("IDENTIFIER: expected 1..128 ASCII alphanumeric or ._:- characters".into());
    }
    Ok(())
}

pub fn validate_domain(value: &str) -> Result<(), String> {
    if value.is_empty()
        || value.len() > 200
        || !value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._:/-".contains(&b))
    {
        return Err("DOMAIN: expected 1..200 ASCII alphanumeric or ._:/- characters".into());
    }
    Ok(())
}

pub fn validate_digest(value: &str) -> Result<(), String> {
    if value.len() != 64
        || !value
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("DIGEST: expected 64 lowercase hexadecimal characters".into());
    }
    Ok(())
}

// serde_json replaces nonfinite floats with null; reject them recursively
// before conversion. This is input validation, not a canonicalizer. All actual
// canonical ordering/escaping/number formatting is delegated to serde_jcs.
#[derive(Clone, Copy)]
struct NumberCheck {
    depth: usize,
}
type CheckError = serde_json::Error;

impl NumberCheck {
    fn child(&self) -> Result<Self, CheckError> {
        if self.depth >= MAX_JSON_DEPTH {
            return Err(serde::ser::Error::custom(
                "JSON_DEPTH: nesting limit exceeded",
            ));
        }
        Ok(Self {
            depth: self.depth + 1,
        })
    }
}

impl serde::Serializer for NumberCheck {
    type Ok = ();
    type Error = CheckError;
    type SerializeSeq = Self;
    type SerializeTuple = Self;
    type SerializeTupleStruct = Self;
    type SerializeTupleVariant = Self;
    type SerializeMap = Self;
    type SerializeStruct = Self;
    type SerializeStructVariant = Self;
    fn serialize_bool(self, _: bool) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_i8(self, v: i8) -> Result<(), CheckError> {
        self.serialize_i64(v.into())
    }
    fn serialize_i16(self, v: i16) -> Result<(), CheckError> {
        self.serialize_i64(v.into())
    }
    fn serialize_i32(self, v: i32) -> Result<(), CheckError> {
        self.serialize_i64(v.into())
    }
    fn serialize_i64(self, v: i64) -> Result<(), CheckError> {
        self.serialize_u64(v.unsigned_abs())
    }
    fn serialize_u8(self, v: u8) -> Result<(), CheckError> {
        self.serialize_u64(v.into())
    }
    fn serialize_u16(self, v: u16) -> Result<(), CheckError> {
        self.serialize_u64(v.into())
    }
    fn serialize_u32(self, v: u32) -> Result<(), CheckError> {
        self.serialize_u64(v.into())
    }
    fn serialize_u64(self, v: u64) -> Result<(), CheckError> {
        if v > MAX_SAFE_INTEGER {
            Err(serde::ser::Error::custom(
                "integer exceeds the safe range; use a decimal string",
            ))
        } else {
            Ok(())
        }
    }
    fn serialize_i128(self, v: i128) -> Result<(), CheckError> {
        if v.unsigned_abs() > MAX_SAFE_INTEGER.into() {
            Err(serde::ser::Error::custom("integer exceeds the safe range"))
        } else {
            Ok(())
        }
    }
    fn serialize_u128(self, v: u128) -> Result<(), CheckError> {
        if v > MAX_SAFE_INTEGER.into() {
            Err(serde::ser::Error::custom("integer exceeds the safe range"))
        } else {
            Ok(())
        }
    }
    fn serialize_f32(self, v: f32) -> Result<(), CheckError> {
        self.serialize_f64(v.into())
    }
    fn serialize_f64(self, v: f64) -> Result<(), CheckError> {
        if v.is_finite() {
            Ok(())
        } else {
            Err(serde::ser::Error::custom("nonfinite number"))
        }
    }
    fn serialize_char(self, _: char) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_str(self, _: &str) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_bytes(self, _: &[u8]) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_none(self) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_some<T: Serialize + ?Sized>(self, v: &T) -> Result<(), CheckError> {
        v.serialize(self)
    }
    fn serialize_unit(self) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_unit_struct(self, _: &'static str) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_unit_variant(
        self,
        _: &'static str,
        _: u32,
        _: &'static str,
    ) -> Result<(), CheckError> {
        Ok(())
    }
    fn serialize_newtype_struct<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        v: &T,
    ) -> Result<(), CheckError> {
        v.serialize(self)
    }
    fn serialize_newtype_variant<T: Serialize + ?Sized>(
        self,
        _: &'static str,
        _: u32,
        _: &'static str,
        v: &T,
    ) -> Result<(), CheckError> {
        v.serialize(self)
    }
    fn serialize_seq(self, _: Option<usize>) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_tuple(self, _: usize) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_tuple_struct(self, _: &'static str, _: usize) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_tuple_variant(
        self,
        _: &'static str,
        _: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_map(self, _: Option<usize>) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_struct(self, _: &'static str, _: usize) -> Result<Self, CheckError> {
        Ok(self)
    }
    fn serialize_struct_variant(
        self,
        _: &'static str,
        _: u32,
        _: &'static str,
        _: usize,
    ) -> Result<Self, CheckError> {
        Ok(self)
    }
}

macro_rules! checked_sequence {
    ($trait:ident, $method:ident) => {
        impl serde::ser::$trait for NumberCheck {
            type Ok = ();
            type Error = CheckError;
            fn $method<T: Serialize + ?Sized>(&mut self, value: &T) -> Result<(), CheckError> {
                value.serialize(self.child()?)
            }
            fn end(self) -> Result<(), CheckError> {
                Ok(())
            }
        }
    };
}
checked_sequence!(SerializeSeq, serialize_element);
checked_sequence!(SerializeTuple, serialize_element);
checked_sequence!(SerializeTupleStruct, serialize_field);
checked_sequence!(SerializeTupleVariant, serialize_field);
impl serde::ser::SerializeMap for NumberCheck {
    type Ok = ();
    type Error = CheckError;
    fn serialize_key<T: Serialize + ?Sized>(&mut self, v: &T) -> Result<(), CheckError> {
        v.serialize(self.child()?)
    }
    fn serialize_value<T: Serialize + ?Sized>(&mut self, v: &T) -> Result<(), CheckError> {
        v.serialize(self.child()?)
    }
    fn end(self) -> Result<(), CheckError> {
        Ok(())
    }
}
macro_rules! checked_struct {
    ($trait:ident) => {
        impl serde::ser::$trait for NumberCheck {
            type Ok = ();
            type Error = CheckError;
            fn serialize_field<T: Serialize + ?Sized>(
                &mut self,
                _: &'static str,
                v: &T,
            ) -> Result<(), CheckError> {
                v.serialize(self.child()?)
            }
            fn end(self) -> Result<(), CheckError> {
                Ok(())
            }
        }
    };
}
checked_struct!(SerializeStruct);
checked_struct!(SerializeStructVariant);
