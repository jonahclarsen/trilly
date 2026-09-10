fn main() {
    println!("cargo:rerun-if-changed=native/keychain.c");
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/keychain.c")
            .flag("-Wno-deprecated-declarations")
            .warnings(true)
            .compile("trilly_keychain");
        println!("cargo:rustc-link-lib=framework=Security");
        println!("cargo:rustc-link-lib=framework=CoreFoundation");
    }
}
