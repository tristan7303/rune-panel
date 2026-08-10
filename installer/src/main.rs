//! The Rune Panel setup shell.
//!
//! One undecorated window, one HTML page, and the real NSIS installer running
//! silently behind it. The NSIS artifact is embedded whole (see build.rs) and
//! executed with `/S` — exactly the invocation the in-app auto-updater already
//! uses, so the engine this shell drives is the engine every update has been
//! installed with all along. The shell adds nothing to the install itself; it
//! only replaces the face.

#![windows_subsystem = "windows"]

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tao::dpi::{LogicalSize, PhysicalPosition};
use tao::event::{Event, WindowEvent};
use tao::event_loop::{ControlFlow, EventLoopBuilder, EventLoopProxy};
use tao::window::WindowBuilder;

mod baked {
    include!(concat!(env!("OUT_DIR"), "/baked.rs"));
}

/// The uninstall key electron-builder writes: a UUID derived from the appId,
/// stable for as long as `org.runepanel.app` is. Where the installed version
/// is read from, to greet an existing install with "Update" instead of
/// "Install".
const UNINSTALL_KEY: &str =
    r"HKCU\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\12709a64-4442-56f6-9a01-90626b376293";

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

enum UserEvent {
    /// A message from the page: install, launch, close, minimize, drag.
    Ipc(String),
    /// Bytes-on-the-ground progress, 0–100, with an optional status line.
    Progress(f64, Option<&'static str>),
    Done,
    Error(String),
}

fn main() {
    let event_loop = EventLoopBuilder::<UserEvent>::with_user_event().build();
    let proxy = event_loop.create_proxy();

    let window = WindowBuilder::new()
        .with_title("Rune Panel Setup")
        .with_decorations(false)
        .with_resizable(false)
        .with_inner_size(LogicalSize::new(660.0, 440.0))
        .build(&event_loop)
        .expect("create window");

    // Centred by hand: an undecorated window gets no help from the shell.
    if let Some(monitor) = window.current_monitor() {
        let screen = monitor.size();
        let win = window.outer_size();
        window.set_outer_position(PhysicalPosition::new(
            monitor.position().x + ((screen.width as i32 - win.width as i32) / 2).max(0),
            monitor.position().y + ((screen.height as i32 - win.height as i32) / 2).max(0),
        ));
    }
    round_corners(&window);

    let html = page_html();

    // WebView2 ships with Windows 10/11 and evergreen-updates itself, so this
    // failing means an unusual machine — offer the plain installer rather
    // than a dead end. The embedded NSIS run *without* `/S` is the full
    // themed wizard, so nobody is left without a path.
    let ipc_proxy = proxy.clone();
    let mut context = wry::WebContext::new(Some(env::temp_dir().join("rune-panel-setup-webview")));
    let webview = match wry::WebViewBuilder::new_with_web_context(&mut context)
        .with_html(html)
        .with_ipc_handler(move |req| {
            let _ = ipc_proxy.send_event(UserEvent::Ipc(req.body().to_string()));
        })
        .build(&window)
    {
        Ok(v) => v,
        Err(_) => {
            fallback_plain_install();
            return;
        }
    };

    let mut installing = false;

    event_loop.run(move |event, _, control_flow| {
        *control_flow = ControlFlow::Wait;

        match event {
            Event::WindowEvent {
                event: WindowEvent::CloseRequested,
                ..
            } => {
                // Alt+F4 mid-install would orphan the engine; the close
                // button in the page is disabled for the same stretch.
                if !installing {
                    *control_flow = ControlFlow::Exit;
                }
            }

            Event::UserEvent(UserEvent::Ipc(msg)) => match msg.as_str() {
                "install" => {
                    if !installing {
                        installing = true;
                        run_install(proxy.clone());
                    }
                }
                "launch" => {
                    let exe = install_dir().join("Rune Panel.exe");
                    let _ = Command::new(exe).spawn();
                    *control_flow = ControlFlow::Exit;
                }
                "close" => {
                    if !installing {
                        *control_flow = ControlFlow::Exit;
                    }
                }
                "minimize" => window.set_minimized(true),
                "drag" => {
                    let _ = window.drag_window();
                }
                _ => {}
            },

            Event::UserEvent(UserEvent::Progress(pct, note)) => {
                let note_js = match note {
                    Some(n) => format!("'{}'", n),
                    None => "null".into(),
                };
                let _ = webview.evaluate_script(&format!(
                    "window.__setup && window.__setup.progress({pct:.2}, {note_js})"
                ));
            }

            Event::UserEvent(UserEvent::Done) => {
                installing = false;
                let _ = webview.evaluate_script("window.__setup && window.__setup.state('done')");
            }

            Event::UserEvent(UserEvent::Error(detail)) => {
                trace(&format!("main: error event: {detail}"));
                installing = false;
                let _ = webview.evaluate_script(&format!(
                    "window.__setup && window.__setup.state('error', '{}')",
                    js_escape(&detail)
                ));
            }

            _ => {}
        }
    });
}

/// The page with its blanks filled in: logo, version, and whether this
/// machine already has Rune Panel (which only changes the words on the
/// button — the engine installs over an existing copy either way).
fn page_html() -> String {
    let mode = match installed_version() {
        Some(v) if v == baked::VERSION => "reinstall",
        Some(_) => "update",
        None if install_dir().join("Rune Panel.exe").is_file() => "update",
        None => "install",
    };
    include_str!("../ui/index.html")
        .replace("{{LOGO}}", &base64(include_bytes!("../../build/icon.png")))
        .replace("{{VERSION}}", baked::VERSION)
        .replace("{{MODE}}", mode)
}

/// Unpack the embedded NSIS installer and run it silently, reporting progress
/// as the install directory fills toward the unpacked size baked in at build
/// time. Capped at 95% until the engine actually exits: the last stretch is
/// shortcuts and registry, which land no bytes but still take a moment.
fn run_install(proxy: EventLoopProxy<UserEvent>) {
    std::thread::spawn(move || {
        trace("worker: start");
        let _ = proxy.send_event(UserEvent::Progress(0.0, Some("Unpacking installer…")));

        let setup = env::temp_dir().join(format!("RunePanel-Setup-{}.exe", baked::VERSION));
        if let Err(e) = fs::write(&setup, baked::PAYLOAD) {
            let _ = proxy.send_event(UserEvent::Error(format!(
                "Could not unpack the installer: {e}"
            )));
            return;
        }
        trace("worker: payload written");

        let spawned = Command::new(&setup).arg("/S").spawn();
        trace(&format!("worker: spawn -> {:?}", spawned.as_ref().map(|c| c.id())));
        let mut child = match spawned {
            Ok(c) => c,
            Err(e) => {
                let sent = proxy.send_event(UserEvent::Error(format!(
                    "Could not start the installer: {e}"
                )));
                trace(&format!("worker: error sent ok={}", sent.is_ok()));
                return;
            }
        };

        let _ = proxy.send_event(UserEvent::Progress(2.0, Some("Installing…")));
        let dest = install_dir();
        let mut finishing = false;

        loop {
            match child.try_wait() {
                Ok(Some(status)) if status.success() => {
                    let _ = proxy.send_event(UserEvent::Done);
                    break;
                }
                Ok(Some(status)) => {
                    let _ = proxy.send_event(UserEvent::Error(format!(
                        "The installer exited with code {}. Nothing was harmed — you can try again.",
                        status.code().unwrap_or(-1)
                    )));
                    break;
                }
                Ok(None) => {
                    let done = dir_size(&dest) as f64 / baked::UNPACKED_BYTES as f64;
                    let pct = (2.0 + done * 93.0).min(95.0);
                    let note = if pct >= 94.0 && !finishing {
                        finishing = true;
                        Some("Finishing up…")
                    } else {
                        None
                    };
                    let _ = proxy.send_event(UserEvent::Progress(pct, note));
                    std::thread::sleep(Duration::from_millis(250));
                }
                Err(e) => {
                    let _ = proxy.send_event(UserEvent::Error(format!(
                        "Lost track of the installer: {e}"
                    )));
                    break;
                }
            }
        }
        let _ = fs::remove_file(&setup);
    });
}

/// Where the NSIS installer puts the app: per-user, no elevation.
fn install_dir() -> PathBuf {
    PathBuf::from(env::var("LOCALAPPDATA").unwrap_or_default())
        .join("Programs")
        .join("Rune Panel")
}

fn installed_version() -> Option<String> {
    use std::os::windows::process::CommandExt;
    let out = Command::new("reg")
        .args(["query", UNINSTALL_KEY, "/v", "DisplayVersion"])
        .creation_flags(CREATE_NO_WINDOW)
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    // "    DisplayVersion    REG_SZ    0.2.2" — the value is the last token.
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|l| l.contains("DisplayVersion"))
        .and_then(|l| l.split_whitespace().last().map(str::to_string))
}

fn dir_size(path: &Path) -> u64 {
    let Ok(entries) = fs::read_dir(path) else {
        return 0;
    };
    entries
        .flatten()
        .map(|entry| match entry.metadata() {
            Ok(m) if m.is_dir() => dir_size(&entry.path()),
            Ok(m) => m.len(),
            Err(_) => 0,
        })
        .sum()
}

/// No WebView2 runtime: explain, and offer the embedded installer with its
/// own visible wizard instead.
fn fallback_plain_install() {
    let text = wide(
        "Rune Panel Setup needs Microsoft Edge WebView2, which this PC does not have.\n\n\
         Install Rune Panel with the standard installer instead?",
    );
    let caption = wide("Rune Panel Setup");
    const MB_YESNO_ICONWARNING: u32 = 0x0000_0034; // MB_YESNO | MB_ICONWARNING
    const IDYES: i32 = 6;
    let pressed = unsafe { MessageBoxW(0, text.as_ptr(), caption.as_ptr(), MB_YESNO_ICONWARNING) };
    if pressed == IDYES {
        let setup = env::temp_dir().join(format!("RunePanel-Setup-{}.exe", baked::VERSION));
        if fs::write(&setup, baked::PAYLOAD).is_ok() {
            let _ = Command::new(&setup).spawn();
        }
    }
}

/// Win11 rounds every framed window; an undecorated one has to ask.
fn round_corners(window: &tao::window::Window) {
    use tao::platform::windows::WindowExtWindows;
    const DWMWA_WINDOW_CORNER_PREFERENCE: u32 = 33;
    const DWMWCP_ROUND: i32 = 2;
    let hwnd = window.hwnd() as isize;
    unsafe {
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_WINDOW_CORNER_PREFERENCE,
            &DWMWCP_ROUND as *const _ as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

#[link(name = "dwmapi")]
extern "system" {
    fn DwmSetWindowAttribute(
        hwnd: isize,
        attr: u32,
        value: *const core::ffi::c_void,
        size: u32,
    ) -> i32;
}

#[link(name = "user32")]
extern "system" {
    fn MessageBoxW(hwnd: isize, text: *const u16, caption: *const u16, flags: u32) -> i32;
}

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Breadcrumbs for a windowed process with no console: appended to
/// %TEMP%\rune-panel-setup.log, but only when RP_SETUP_LOG is set.
fn trace(line: &str) {
    if env::var_os("RP_SETUP_LOG").is_none() {
        return;
    }
    use std::io::Write;
    if let Ok(mut f) = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(env::temp_dir().join("rune-panel-setup.log"))
    {
        let _ = writeln!(f, "{line}");
    }
}

fn js_escape(s: &str) -> String {
    s.replace('\\', "\\\\")
        .replace('\'', "\\'")
        .replace('\n', "\\n")
        .replace('\r', "")
}

/// Standard base64, hand-rolled because it is the only encoding this binary
/// needs and fifteen lines beat a dependency.
fn base64(data: &[u8]) -> String {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity(data.len().div_ceil(3) * 4);
    for chunk in data.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        out.push(TABLE[(n >> 18) as usize & 63] as char);
        out.push(TABLE[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
    }
    out
}
