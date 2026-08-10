//! Bakes the release into the shell.
//!
//! The real installer — the NSIS exe electron-builder produced — is embedded
//! into this binary as bytes, along with the version it carries and how many
//! bytes it unpacks to (which is what turns "watch the install directory grow"
//! into a percentage). All three arrive as environment variables set by
//! scripts/build-setup.mjs:
//!
//!   RP_PAYLOAD         absolute path to RunePanel-Setup-<version>.exe
//!   RP_VERSION         the version inside it
//!   RP_UNPACKED_BYTES  total size of win-unpacked, in bytes
//!
//! Without them (a bare `cargo build` while working on the shell) a tiny dummy
//! payload is baked instead, so the UI and window code can be iterated on
//! without a ten-minute electron-builder run first.

use std::env;
use std::fs;
use std::path::PathBuf;

fn main() {
    println!("cargo:rerun-if-env-changed=RP_PAYLOAD");
    println!("cargo:rerun-if-env-changed=RP_VERSION");
    println!("cargo:rerun-if-env-changed=RP_UNPACKED_BYTES");
    println!("cargo:rerun-if-changed=../build/icon.png");
    println!("cargo:rerun-if-changed=ui/index.html");

    let out = PathBuf::from(env::var("OUT_DIR").unwrap());

    let payload = match env::var("RP_PAYLOAD") {
        Ok(p) => PathBuf::from(p),
        Err(_) => {
            let dummy = out.join("dummy-payload.bin");
            fs::write(&dummy, b"not a real installer - dev build").unwrap();
            dummy
        }
    };
    assert!(
        payload.is_file(),
        "RP_PAYLOAD does not exist: {}",
        payload.display()
    );

    let version = env::var("RP_VERSION").unwrap_or_else(|_| "0.0.0-dev".into());
    let unpacked: u64 = env::var("RP_UNPACKED_BYTES")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1);

    fs::write(
        out.join("baked.rs"),
        format!(
            "pub const PAYLOAD: &[u8] = include_bytes!(r\"{}\");\n\
             pub const VERSION: &str = \"{}\";\n\
             pub const UNPACKED_BYTES: u64 = {};\n",
            payload.display(),
            version.replace('"', ""),
            unpacked.max(1)
        ),
    )
    .unwrap();

    // The exe's own icon, converted from the app's png so there is no second
    // icon file to keep in sync. 256 down to 16 — the shell sizes Windows
    // actually asks for.
    let ico = out.join("icon.ico");
    let img = image::open("../build/icon.png").expect("build/icon.png");
    let mut frames = Vec::new();
    for size in [256u32, 64, 48, 32, 16] {
        let resized = img.resize_exact(size, size, image::imageops::FilterType::Lanczos3);
        let rgba = resized.to_rgba8();
        frames.push(
            image::codecs::ico::IcoFrame::as_png(rgba.as_raw(), size, size, image::ExtendedColorType::Rgba8)
                .expect("encode ico frame"),
        );
    }
    let file = fs::File::create(&ico).unwrap();
    image::codecs::ico::IcoEncoder::new(file)
        .encode_images(&frames)
        .expect("write icon.ico");

    // Version info, icon, and a manifest that says exactly what the shell is:
    // per-user (no elevation prompt — the payload installs under AppData), and
    // per-monitor DPI aware so the window is crisp on any screen.
    let mut res = winresource::WindowsResource::new();
    res.set_icon(ico.to_str().unwrap());
    res.set("ProductName", "Rune Panel");
    res.set("FileDescription", "Rune Panel Setup");
    res.set("LegalCopyright", "Rune Panel. Not affiliated with Jagex or the OSRS Wiki.");
    res.set("ProductVersion", &version);
    res.set("FileVersion", &version);
    res.set_manifest(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0">
  <trustInfo xmlns="urn:schemas-microsoft-com:asm.v3">
    <security>
      <requestedPrivileges>
        <requestedExecutionLevel level="asInvoker" uiAccess="false"/>
      </requestedPrivileges>
    </security>
  </trustInfo>
  <application xmlns="urn:schemas-microsoft-com:asm.v3">
    <windowsSettings>
      <dpiAwareness xmlns="http://schemas.microsoft.com/SMI/2016/WindowsSettings">PerMonitorV2</dpiAwareness>
    </windowsSettings>
  </application>
</assembly>"#,
    );
    res.compile().expect("compile windows resources");
}
