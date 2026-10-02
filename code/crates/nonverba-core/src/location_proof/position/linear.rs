// SPDX-License-Identifier: AGPL-3.0-only
//! Bounded four-unknown weighted least squares with reorthogonalized QR.
//! Never invert normal equations to obtain the position update.
pub(super) fn solve(rows: &[[f64; 4]], values: &[f64]) -> Result<[f64; 4], String> {
    if rows.len() < 4 || rows.len() != values.len() {
        return Err("Insufficient GPS geometry".into());
    }
    let mut q: Vec<Vec<f64>> = (0..4)
        .map(|j| rows.iter().map(|r| r[j]).collect())
        .collect();
    let mut r = [[0.0; 4]; 4];
    let mut scales = [0.0_f64; 4];
    for j in 0..4 {
        scales[j] = q[j].iter().map(|v| v * v).sum::<f64>().sqrt();
        for _ in 0..2 {
            for i in 0..j {
                let projection = q[i].iter().zip(&q[j]).map(|(a, b)| a * b).sum::<f64>();
                r[i][j] += projection;
                let (previous, current) = q.split_at_mut(j);
                for (value, basis) in current[0].iter_mut().zip(&previous[i]) {
                    *value -= projection * basis;
                }
            }
        }
        r[j][j] = q[j].iter().map(|v| v * v).sum::<f64>().sqrt();
        if !r[j][j].is_finite() || r[j][j] < 1e-8 * scales[j].max(1e-12) {
            return Err("GPS geometry is singular or ill-conditioned".into());
        }
        for value in &mut q[j] {
            *value /= r[j][j];
        }
    }
    let mut result = [0.0; 4];
    for i in (0..4).rev() {
        let rhs = q[i].iter().zip(values).map(|(a, b)| a * b).sum::<f64>();
        result[i] = (rhs - ((i + 1)..4).map(|j| r[i][j] * result[j]).sum::<f64>()) / r[i][i];
    }
    if !result.iter().all(|v| v.is_finite()) {
        return Err("GPS least-squares result is not finite".into());
    }
    Ok(result)
}
pub(super) fn pdop(rows: &[[f64; 4]]) -> Result<f64, String> {
    // Columns of the pseudoinverse supply the diagonal of (H'H)^-1 without
    // explicit inversion. N<=32, so the bounded extra QR work is negligible.
    let mut trace = 0.0;
    for i in 0..rows.len() {
        let mut basis = vec![0.0; rows.len()];
        basis[i] = 1.0;
        let column = solve(rows, &basis)?;
        trace += column[..3].iter().map(|v| v * v).sum::<f64>();
    }
    Ok(trace.sqrt())
}
