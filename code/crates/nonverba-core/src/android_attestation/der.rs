// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded canonical DER reader for Android's explicitly tagged extension.
//! X.509 certificate interpretation is delegated to x509-parser.
#[derive(Clone, Copy)]
pub(super) struct Node<'a> {
    pub class: u8,
    pub constructed: bool,
    pub tag: u32,
    pub body: &'a [u8],
    pub encoded: &'a [u8],
}
pub(super) fn take<'a>(input: &mut &'a [u8]) -> Result<Node<'a>, String> {
    let original = *input;
    let first = *input.first().ok_or("Truncated DER tag")?;
    *input = &input[1..];
    let mut tag = u32::from(first & 31);
    if tag == 31 {
        tag = 0;
        let mut count = 0;
        loop {
            let b = *input.first().ok_or("Truncated DER high tag")?;
            *input = &input[1..];
            if count == 0 && b & 127 == 0 {
                return Err("Noncanonical DER high tag".into());
            }
            count += 1;
            if count > 4 {
                return Err("DER tag exceeds limit".into());
            }
            tag = tag
                .checked_mul(128)
                .and_then(|v| v.checked_add(u32::from(b & 127)))
                .ok_or("DER tag overflow")?;
            if b & 128 == 0 {
                break;
            }
        }
        if tag < 31 {
            return Err("Noncanonical DER tag".into());
        }
    }
    let length = *input.first().ok_or("Truncated DER length")?;
    *input = &input[1..];
    let len = if length & 128 == 0 {
        usize::from(length)
    } else {
        let count = usize::from(length & 127);
        if count == 0 || count > 3 || input.len() < count || input[0] == 0 {
            return Err("Invalid DER length".into());
        }
        let len = input[..count]
            .iter()
            .fold(0usize, |v, b| v * 256 + usize::from(*b));
        *input = &input[count..];
        if len < 128 {
            return Err("Noncanonical DER long length".into());
        }
        len
    };
    if input.len() < len {
        return Err("Truncated DER content".into());
    }
    let body = &input[..len];
    *input = &input[len..];
    Ok(Node {
        class: first >> 6,
        constructed: first & 32 != 0,
        tag,
        body,
        encoded: &original[..original.len() - input.len()],
    })
}
pub(super) fn one(input: &[u8]) -> Result<Node<'_>, String> {
    let mut rest = input;
    let node = take(&mut rest)?;
    if !rest.is_empty() {
        return Err("Trailing DER content".into());
    }
    Ok(node)
}
impl<'a> Node<'a> {
    pub fn expect(self, tag: u32, constructed: bool) -> Result<Self, String> {
        if self.class != 0 || self.tag != tag || self.constructed != constructed {
            return Err("Unexpected DER type".into());
        }
        Ok(self)
    }
    pub fn integer(self) -> Result<u64, String> {
        if self.class != 0 || !matches!(self.tag, 2 | 10) || self.constructed {
            return Err("Expected DER integer".into());
        }
        let b = self.body;
        if b.is_empty()
            || b[0] & 128 != 0
            || b.len() > 9
            || (b.len() > 1 && b[0] == 0 && b[1] & 128 == 0)
            || (b.len() == 9 && b[0] != 0)
        {
            return Err("Invalid unsigned DER integer".into());
        }
        Ok(b.iter().fold(0u64, |n, b| (n << 8) | u64::from(*b)))
    }
    pub fn boolean(self) -> Result<bool, String> {
        self.expect(1, false)?;
        match self.body {
            [0] => Ok(false),
            [255] => Ok(true),
            _ => Err("Invalid DER boolean".into()),
        }
    }
    pub fn octets(self) -> Result<&'a [u8], String> {
        Ok(self.expect(4, false)?.body)
    }
    pub fn children(self, tag: u32) -> Result<Vec<Node<'a>>, String> {
        self.expect(tag, true)?;
        let mut rest = self.body;
        let mut nodes = Vec::new();
        while !rest.is_empty() {
            if nodes.len() >= 96 {
                return Err("Too many DER children".into());
            }
            nodes.push(take(&mut rest)?);
        }
        if tag == 17 && nodes.windows(2).any(|p| p[0].encoded >= p[1].encoded) {
            return Err("Noncanonical DER SET".into());
        }
        Ok(nodes)
    }
}
pub(super) fn canonical(input: &[u8]) -> Result<(), String> {
    fn visit(node: Node<'_>, depth: usize, budget: &mut usize) -> Result<(), String> {
        if depth > 16 || *budget == 0 {
            return Err("DER structure exceeds limits".into());
        }
        *budget -= 1;
        if node.constructed {
            let mut rest = node.body;
            let mut prior: Option<&[u8]> = None;
            while !rest.is_empty() {
                let child = take(&mut rest)?;
                if node.class == 0 && node.tag == 17 && prior.is_some_and(|p| p >= child.encoded) {
                    return Err("Noncanonical DER SET".into());
                }
                prior = Some(child.encoded);
                visit(child, depth + 1, budget)?;
            }
        } else if node.class == 0 {
            match node.tag {
                1 => {
                    node.boolean()?;
                }
                2 | 10 => {
                    let b = node.body;
                    if b.is_empty()
                        || (b.len() > 1
                            && ((b[0] == 0 && b[1] & 128 == 0) || (b[0] == 255 && b[1] & 128 != 0)))
                    {
                        return Err("Noncanonical DER integer".into());
                    }
                }
                3 => {
                    let unused = *node.body.first().ok_or("Empty DER bit string")?;
                    if unused > 7
                        || (node.body.len() == 1 && unused != 0)
                        || (unused > 0 && node.body.last().unwrap() & ((1u8 << unused) - 1) != 0)
                    {
                        return Err("Noncanonical DER bit string".into());
                    }
                }
                5 if !node.body.is_empty() => return Err("Invalid DER NULL".into()),
                16 | 17 => return Err("Primitive DER container".into()),
                _ => {}
            }
        }
        Ok(())
    }
    visit(one(input)?, 0, &mut 4096)
}
