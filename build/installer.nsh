; Rune Panel's installer, dressed.
;
; electron-builder generates the NSIS script; this is the hook it offers for
; adding to it.
;
; Why NSIS at all, rather than something that would look better with less
; fighting: electron-updater downloads `latest.yml` and the NSIS installer as
; separate URLs and runs that installer to apply an update. An installer of a
; different shape would be a nicer first impression bought at the cost of every
; impression after it.
;
; Interior pages are deliberately left alone. Their colours come from the
; Windows dialog theme, and repainting them means drawing every control by hand
; through nsDialogs — a lot of NSIS for pages most people see for two seconds on
; the way past.

; `!define` on a name that already has one is an error in NSIS, not an
; overwrite — and electron-builder sets several of these itself before this file
; is reached. So each is cleared first, guarded, because which ones it sets is
; its business and may change between versions.
!macro rpSet name value
  !ifdef ${name}
    !undef ${name}
  !endif
  !define ${name} `${value}`
!macroend

/**
 * Everything the wizard's pages are told, set from here.
 *
 * This macro exists to add a welcome page — an assisted install has none of its
 * own and opens straight onto "Choose Installation Options", which is a question
 * before an introduction. But it is also the only hook that runs *before* the
 * pages are defined: electron-builder includes `assistedInstaller.nsh`, where
 * every page is inserted, several lines before it inserts `customHeader`.
 * Anything page-related set in `customHeader` is read after MUI has already
 * built the pages, which is why the first version of this changed nothing at
 * all — the colours and the wording were both simply too late.
 *
 * So the defines sit here, ahead of the first page, and hold for the rest of
 * the file: the finish page is inserted further down and picks them up. Setting
 * them by replacing `customFinishPage` would work too, and would cost the "run
 * Rune Panel now" checkbox, which that macro is otherwise responsible for.
 */
!macro customWelcomePage
  ; The welcome and finish pages, in the palette the app opens in. NSIS wants
  ; RRGGBB with no hash.
  !insertmacro rpSet MUI_BGCOLOR "2b211a"
  !insertmacro rpSet MUI_TEXTCOLOR "f5e9d8"

  !insertmacro rpSet MUI_WELCOMEPAGE_TITLE "Rune Panel"
  !insertmacro rpSet MUI_WELCOMEPAGE_TEXT "The Old School RuneScape wiki, a keystroke away — plus prices, calculators, hiscores and notes, in a panel that sits over the game.$\r$\n$\r$\nThis installs for your account only. No administrator rights are needed and nothing is written outside your user folder.$\r$\n$\r$\nClick Next to continue."

  !insertmacro rpSet MUI_FINISHPAGE_TITLE "Rune Panel is installed"
  !insertmacro rpSet MUI_FINISHPAGE_TEXT "Press Ctrl+Shift+Space to summon it from anywhere, including over the game.$\r$\n$\r$\nOn first launch it downloads the wiki's page list, which takes about four minutes. Search is patchy until that finishes."

  !insertmacro MUI_PAGE_WELCOME
!macroend
