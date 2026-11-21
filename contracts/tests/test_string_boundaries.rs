use scoutchain_contracts::{validate_string, MAX_VALIDATE_BUF};

#[test]
fn rejects_all_c0_control_chars() {
    for byte in 0x00u8..=0x1F {
        let s = format!("abc{}def", byte as char);
        assert!(
            validate_string(&s).is_err(),
            "expected rejection of C0 control char 0x{:02X}",
            byte
        );
    }
}

#[test]
fn rejects_null_byte() {
    assert!(validate_string("a\0b").is_err());
    assert!(validate_string("\0").is_err());
}

#[test]
fn rejects_del_char() {
    assert!(validate_string("abc\u{7F}def").is_err());
    assert!(validate_string("\u{7F}").is_err());
}

#[test]
fn accepts_printable_strings() {
    assert!(validate_string("hello world").is_ok());
    assert!(validate_string("!@#$%^&*()_+-=[]{}|;':\",.<>/?").is_ok());
    assert!(validate_string("~ ").is_ok());
}

#[test]
fn accepts_string_at_max_length_128() {
    let s = "a".repeat(128);
    assert!(validate_string(&s).is_ok());
}

#[test]
fn rejects_string_above_max_length_128() {
    let s = "a".repeat(129);
    assert!(validate_string(&s).is_err());
}

#[test]
fn accepts_string_at_max_length_1024() {
    let s = "a".repeat(1024);
    assert!(validate_string(&s).is_ok());
}

#[test]
fn rejects_string_above_max_length_1024() {
    let s = "a".repeat(1025);
    assert!(validate_string(&s).is_err());
}

#[test]
fn exercises_max_validate_buf_bound() {
    // A string exactly at the validation buffer bound must be handled without panic.
    let at_bound = "a".repeat(MAX_VALIDATE_BUF);
    let _ = validate_string(&at_bound);

    // A string exceeding the validation buffer bound must be rejected, not panic.
    let over_bound = "a".repeat(MAX_VALIDATE_BUF + 1);
    assert!(validate_string(&over_bound).is_err());
}
