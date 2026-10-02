// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded, nonnegative integer minor-unit amounts. Never floating-point money.

use serde::{Deserialize, Deserializer, Serialize};

pub const MAX_MINOR_UNITS: u64 = 9_007_199_254_740_991;

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
pub struct Money {
    pub minor_units: String,
    pub currency: String,
    pub exponent: u8,
}

impl<'de> Deserialize<'de> for Money {
    fn deserialize<D: Deserializer<'de>>(de: D) -> Result<Self, D::Error> {
        #[derive(Deserialize)]
        #[serde(deny_unknown_fields)]
        struct Fields {
            minor_units: String,
            currency: String,
            exponent: u8,
        }
        let fields = Fields::deserialize(de)?;
        let amount = Self {
            minor_units: fields.minor_units,
            currency: fields.currency,
            exponent: fields.exponent,
        };
        amount.validate().map_err(serde::de::Error::custom)?;
        Ok(amount)
    }
}

pub fn currency_exponent(currency: &str) -> Result<u8, String> {
    match currency {
        "USD" | "EUR" | "NOK" => Ok(2),
        "JPY" => Ok(0),
        "KWD" => Ok(3),
        _ => Err("MONEY_CURRENCY: currency is not supported by this protocol version".into()),
    }
}

/// Canonical decimal integer grammar: `0` or `[1-9][0-9]*`, no signs,
/// whitespace, Unicode digits, leading zero, decimal point or exponent.
pub fn parse_minor_units(value: &str) -> Result<u64, String> {
    if value.is_empty()
        || value.len() > 16
        || !value.bytes().all(|b| b.is_ascii_digit())
        || (value.len() > 1 && value.starts_with('0'))
    {
        return Err("MONEY_ENCODING: expected a canonical decimal integer string".into());
    }
    let units = value
        .parse::<u64>()
        .map_err(|_| "MONEY_BOUNDS: invalid integer".to_owned())?;
    if units > MAX_MINOR_UNITS {
        return Err("MONEY_BOUNDS: amount exceeds 9007199254740991 minor units".into());
    }
    Ok(units)
}

impl Money {
    pub fn new(minor_units: &str, currency: &str) -> Result<Self, String> {
        let amount = Self {
            minor_units: minor_units.into(),
            currency: currency.into(),
            exponent: currency_exponent(currency)?,
        };
        amount.validate()?;
        Ok(amount)
    }

    pub fn validate(&self) -> Result<u64, String> {
        if currency_exponent(&self.currency)? != self.exponent {
            return Err(
                "MONEY_EXPONENT: currency exponent differs from the pinned allowlist".into(),
            );
        }
        parse_minor_units(&self.minor_units)
    }

    fn compatible(&self, other: &Self) -> Result<(u64, u64), String> {
        let left = self.validate()?;
        let right = other.validate()?;
        if self.currency != other.currency || self.exponent != other.exponent {
            return Err("MONEY_MISMATCH: amounts have different currencies or exponents".into());
        }
        Ok((left, right))
    }

    pub fn checked_add(&self, other: &Self) -> Result<Self, String> {
        let (left, right) = self.compatible(other)?;
        let sum = left
            .checked_add(right)
            .filter(|v| *v <= MAX_MINOR_UNITS)
            .ok_or_else(|| "MONEY_OVERFLOW: sum exceeds the supported bound".to_owned())?;
        Self::new(&sum.to_string(), &self.currency)
    }

    pub fn checked_sub(&self, other: &Self) -> Result<Self, String> {
        let (left, right) = self.compatible(other)?;
        let difference = left.checked_sub(right).ok_or_else(|| {
            "MONEY_UNDERFLOW: subtraction would create a negative amount".to_owned()
        })?;
        Self::new(&difference.to_string(), &self.currency)
    }
}
