const LOW: u128 = (1 << 64) - 1;

/// floor(a * b / d) without overflowing the intermediate product.
pub fn mul_div(a: u128, b: u128, d: u128) -> u128 {
    assert!(d != 0, "division by zero");
    let (hi, lo) = mul_wide(a, b);
    assert!(hi < d, "mul_div overflow");
    div_wide(hi, lo, d)
}

fn mul_wide(a: u128, b: u128) -> (u128, u128) {
    let (a1, a0) = (a >> 64, a & LOW);
    let (b1, b0) = (b >> 64, b & LOW);
    let p00 = a0 * b0;
    let p01 = a0 * b1;
    let p10 = a1 * b0;
    let p11 = a1 * b1;
    let mid = (p00 >> 64) + (p01 & LOW) + (p10 & LOW);
    let lo = (p00 & LOW) | (mid << 64);
    let hi = p11 + (p01 >> 64) + (p10 >> 64) + (mid >> 64);
    (hi, lo)
}

fn div_wide(hi: u128, lo: u128, d: u128) -> u128 {
    let mut rem = hi;
    let mut q = 0u128;
    for i in (0..128).rev() {
        let carry = rem >> 127;
        rem = (rem << 1) | ((lo >> i) & 1);
        if carry == 1 || rem >= d {
            rem = rem.wrapping_sub(d);
            q |= 1 << i;
        }
    }
    q
}

pub fn bps(amount: u128, bps: u16) -> u128 {
    mul_div(amount, bps as u128, 10_000)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn small_values() {
        assert_eq!(mul_div(6, 7, 3), 14);
        assert_eq!(mul_div(10, 10, 3), 33);
        assert_eq!(mul_div(0, u128::MAX, 5), 0);
    }

    #[test]
    fn wide_product() {
        let near = 10u128.pow(24);
        let a = 5_000_000 * near;
        let b = 3_000_000 * near;
        let d = 7_000_000 * near;
        let expected = a / 7 * 3;
        let got = mul_div(a, b, d);
        assert!(got >= expected && got - expected < 10);
        assert_eq!(mul_div(u128::MAX, u128::MAX, u128::MAX), u128::MAX);
        assert_eq!(mul_div(u128::MAX, 2, 4), u128::MAX / 2);
    }

    #[test]
    fn matches_native_when_no_overflow() {
        let cases = [(123456789u128, 987654321u128, 1000u128), (1 << 60, 1 << 60, 12345), (99, 1, 100)];
        for (a, b, d) in cases {
            assert_eq!(mul_div(a, b, d), a * b / d);
        }
    }

    #[test]
    #[should_panic(expected = "mul_div overflow")]
    fn overflow_panics() {
        mul_div(u128::MAX, 2, 1);
    }

    #[test]
    #[should_panic(expected = "division by zero")]
    fn zero_divisor_panics() {
        mul_div(1, 1, 0);
    }

    #[test]
    fn basis_points() {
        assert_eq!(bps(10_000, 200), 200);
        assert_eq!(bps(1, 200), 0);
    }
}
