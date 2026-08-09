; Rune Panel's installer.
;
; NSIS, because electron-updater downloads `latest.yml` and this installer as
; separate URLs and runs it with /S to apply an update. An installer of another
; shape would be a nicer first impression bought with every impression after it.
;
; NSIS is only the machinery, though — none of the wizard it ships with is kept.
; Silent mode skips every page, so what follows is free to look like whatever it
; likes without touching the update path at all.
;
; What is left: one page that says what is being installed and where, a themed
; progress page, and a themed finish. No step-by-step, no options nobody wants
; to answer, and nothing white.

; `!define` on a name that already has one is an error in NSIS rather than an
; overwrite, and electron-builder sets several of these itself before this file
; is reached. Each is cleared first, guarded, since which ones it sets is its
; business and may change between versions.
!macro rpSet name value
  !ifdef ${name}
    !undef ${name}
  !endif
  !define ${name} `${value}`
!macroend

; The page below is built with nsDialogs, and the functions that build it are
; compiled the moment electron-builder includes this file — which is before it
; includes anything of its own. The header carries its own include guard, so
; asking for it here is free even though it is included again later.
!include nsDialogs.nsh

; Win32 constants this file uses. Guarded rather than assumed: which headers
; electron-builder has already included is its business, and a name it has not
; defined is a warning NSIS treats as an error — so the build fails on the
; spelling of a constant rather than anything that matters.
!ifndef SW_HIDE
  !define SW_HIDE 0
!endif
!ifndef WM_SETTEXT
  !define WM_SETTEXT 0x000C
!endif
!ifndef WM_SETFONT
  !define WM_SETFONT 0x0030
!endif
!ifndef SS_CENTER
  !define SS_CENTER 0x00000001
!endif

; Plain RRGGBB — `SetCtlColors` takes them the way they are written everywhere
; else. Byte-swapped on the first attempt, on the assumption that a Win32 API
; underneath meant COLORREF's BGR; the installer came out navy blue.
!define RP_BG 0x2b211a
!define RP_TEXT 0xf5e9d8
!define RP_DIM 0xa3927f

/**
 * Put one control of a page under our colours, if it is there at all.
 *
 * The theme call is the load-bearing half. With visual styles on, a checkbox is
 * drawn entirely by the theme engine — label included — and it never asks the
 * parent what colour to use, so `SetCtlColors` on its own leaves the caption
 * black on a near-black page. Detaching the control from the theme hands it
 * back to the parent, at the cost of a classic checkbox glyph instead of the
 * modern one.
 *
 * `$0` must hold the page's dialog. Missing ids come back as 0 and are skipped
 * rather than passed to an API that would quietly do nothing with them.
 */
!macro rpRepaint id
  GetDlgItem $1 $0 ${id}
  StrCmp $1 0 +3 0
    System::Call "uxtheme::SetWindowTheme(p $1, w ' ', w ' ')"
    SetCtlColors $1 ${RP_TEXT} ${RP_BG}
!macroend

; Declared under the same guard as the page that uses them: an unused variable
; is another warning, and warnings are errors here.
!ifndef BUILD_UNINSTALLER
Var rpDialog
Var rpLogo
Var rpLogoCtl
!endif

/**
 * Install for the person running it, without asking.
 *
 * This hook fires just before the "Choose Installation Options" page decides
 * whether to show itself, and forcing the current-user answer is the documented
 * way to skip it — the page aborts itself when this is set. Rune Panel goes
 * under the user's own AppData, needs no elevation, and has nothing to say
 * about machine-wide installs, so the question only ever had one useful answer.
 */
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

/**
 * Everything the pages are told, plus the one page there is.
 *
 * It has to live here rather than in `customHeader`, which is the macro that
 * sounds like it is for exactly this: electron-builder includes the file that
 * inserts every page several lines *before* it inserts `customHeader`, so
 * defines made there are read after MUI has already built the pages. An earlier
 * version of this set its colours from `customHeader` and changed nothing at
 * all, silently. This hook is the first thing inside that file, so what it
 * defines holds for the pages below it — the progress and finish pages
 * included, which is how they are reached without replacing them.
 */
!macro customWelcomePage
  !insertmacro rpSet MUI_BGCOLOR "2b211a"
  !insertmacro rpSet MUI_TEXTCOLOR "f5e9d8"

  !insertmacro rpSet MUI_FINISHPAGE_TITLE "Rune Panel is ready"
  !insertmacro rpSet MUI_FINISHPAGE_TEXT "Press Ctrl+Shift+Space to summon it from anywhere, including over the game.$\r$\n$\r$\nOn first launch it downloads the wiki's page list, which takes about four minutes. Search is patchy until that finishes."

  Page custom rpIntroPage
!macroend

/**
 * The progress page's paint hook, declared as late as it can be.
 *
 * `MUI_PAGE_CUSTOMFUNCTION_SHOW` is not a setting, it is a one-shot: MUI calls
 * it and then `!undef`s it, so whichever page is inserted next claims it. Set
 * alongside the colours above, it was eaten by the "choose installation
 * options" page — which this file also skips, so the function was wired to a
 * page that never appears and simply never ran. That is why the progress page
 * stayed white through two builds.
 *
 * This hook is inserted immediately before the progress page and nothing sits
 * between them, so the definition survives exactly long enough.
 */
!macro customPageAfterChangeDir
  !insertmacro rpSet MUI_PAGE_CUSTOMFUNCTION_SHOW rpInstallShow
!macroend

/**
 * The finish page, taken over only so its checkbox can be read.
 *
 * MUI colours the page from `MUI_BGCOLOR`, but the "run Rune Panel" checkbox
 * keeps the system's text colour — near-black, on our near-black — so the one
 * control on the page that does anything was an unreadable smudge.
 *
 * Replacing the page is the only way to get a paint hook onto it, since the
 * hook is a one-shot the progress page has already taken. The launch behaviour
 * below is electron-builder's own, copied rather than reinvented: it is what
 * makes the checkbox start the app as the logged-in user rather than as the
 * installer, and getting that subtly wrong is how an app ends up running with
 * the wrong permissions.
 */
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !insertmacro rpSet MUI_FINISHPAGE_RUN ""
    !insertmacro rpSet MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
  !endif

  !insertmacro rpSet MUI_PAGE_CUSTOMFUNCTION_SHOW rpFinishShow
  !insertmacro MUI_PAGE_FINISH
!macroend

/**
 * The only page before the install runs.
 *
 * A wizard asks a series of questions; this states what is about to happen and
 * offers one button. The mark, the name, a line about what it is, and where it
 * is going — which is the one fact a person actually wants confirmed, and the
 * reason the directory page is gone rather than merely skipped.
 */
; The uninstaller is compiled as a separate pass over this same file, and it has
; no pages of ours — so outside that guard this function is dead code there, and
; NSIS reports dead code as a warning, which electron-builder treats as an error.
!ifndef BUILD_UNINSTALLER
Function rpIntroPage
  nsDialogs::Create 1018
  Pop $rpDialog
  ; Plain StrCmp rather than LogicLib's ${If}: whether LogicLib has been
  ; included by the time this file is reached is electron-builder's business,
  ; and this needs one comparison.
  StrCmp $rpDialog error 0 +2
    Abort
  SetCtlColors $rpDialog ${RP_TEXT} ${RP_BG}

  /**
   * The frame, darkened, from here rather than from `.onGUIInit`.
   *
   * MUI paints the pages themselves from `MUI_BGCOLOR`, but the strip along the
   * bottom holding the buttons belongs to the outer dialog and keeps the system
   * colour — a band of Windows grey under an otherwise dark window, which is
   * the seam that makes a thing look half-themed. `MUI_CUSTOMFUNCTION_GUIINIT`
   * is the hook meant for this and is useless here: MUI reads it when it is
   * included, which is line 9 of the generated script, long before this file.
   * Doing it from the first page shown costs nothing — the colour is a property
   * of the window and outlives the page that set it.
   *
   * The buttons stay native on purpose. A hand-drawn button that does not
   * respond the way the system's does is worse than one that does not match.
   */
  SetCtlColors $HWNDPARENT ${RP_TEXT} ${RP_BG}
  GetDlgItem $0 $HWNDPARENT 1028
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1256
  ShowWindow $0 ${SW_HIDE}

  ; The header strip belongs to the wizard, and this page is not one.
  GetDlgItem $0 $HWNDPARENT 1034
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1035
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1036
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1037
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1038
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1039
  ShowWindow $0 ${SW_HIDE}
  GetDlgItem $0 $HWNDPARENT 1045
  ShowWindow $0 ${SW_HIDE}
  ; The badge itself, which is a separate control from the text beside it and
  ; stayed on screen as a lone tile when only the text was hidden.
  GetDlgItem $0 $HWNDPARENT 1046
  ShowWindow $0 ${SW_HIDE}

  ${NSD_CreateBitmap} 0u 6u 100% 60u ""
  Pop $rpLogoCtl
  ${NSD_SetStretchedImage} $rpLogoCtl "$PLUGINSDIR\rpMark.bmp" $rpLogo

  ${NSD_CreateLabel} 0u 74u 100% 16u "Rune Panel"
  Pop $0
  SetCtlColors $0 ${RP_TEXT} transparent
  CreateFont $1 "$(^Font)" 15 700
  SendMessage $0 ${WM_SETFONT} $1 1
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ${NSD_CreateLabel} 20u 94u -40u 26u "The Old School RuneScape wiki over your game, a keystroke away — with prices, calculators, hiscores and notes."
  Pop $0
  SetCtlColors $0 ${RP_DIM} transparent
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ${NSD_CreateLabel} 20u 126u -40u 10u "Installs to $INSTDIR"
  Pop $0
  SetCtlColors $0 ${RP_DIM} transparent
  ${NSD_AddStyle} $0 ${SS_CENTER}

  ; The wizard's Next button is the only action on the page, so it says what it
  ; does rather than where it goes.
  GetDlgItem $0 $HWNDPARENT 1
  SendMessage $0 ${WM_SETTEXT} 0 "STR:Install"
  ; Nothing to go back to.
  GetDlgItem $0 $HWNDPARENT 3
  ShowWindow $0 ${SW_HIDE}

  nsDialogs::Show
  ${NSD_FreeImage} $rpLogo
FunctionEnd

/**
 * The progress page, painted as it appears.
 *
 * It is a stock NSIS page rather than an MUI one, so it takes none of the
 * colours the others do and would otherwise flash back to Windows grey the
 * instant Install is pressed — the one moment the window is guaranteed to have
 * the reader's attention.
 *
 * The bar itself is a common control and keeps the system's own look. Colouring
 * it means switching it out of themed rendering first, at which point it stops
 * looking like a Windows progress bar and starts looking like a 1998 one; the
 * system's is better than anything gained by matching it.
 */
Function rpInstallShow
  FindWindow $0 "#32770" "" $HWNDPARENT
  SetCtlColors $0 ${RP_TEXT} ${RP_BG}

  ; The line above the bar that names the file being written.
  GetDlgItem $1 $0 1006
  SetCtlColors $1 ${RP_DIM} ${RP_BG}

  /**
   * The log of every file written, removed rather than recoloured.
   *
   * Recolouring was the first attempt and did nothing: it is a list box, and it
   * paints its own background whatever `SetCtlColors` is told, so the page kept
   * a white slab across two thirds of it. Hiding it is also the better answer —
   * a scrolling list of file paths is a thing installers used to show because
   * copying files was slow enough to need proof it was happening.
   */
  GetDlgItem $1 $0 1016
  ShowWindow $1 ${SW_HIDE}

  ; And the button that would bring it back.
  GetDlgItem $1 $0 1027
  ShowWindow $1 ${SW_HIDE}

  /**
   * The bar, moved off the top edge.
   *
   * With the list gone it was left floating against the header with a dark void
   * under it. There is no layout here to reflow — a stock NSIS page is fixed
   * coordinates — so the bar and its caption are moved by hand, to a third of
   * the way down the space they now have to themselves.
   */
  System::Call "*(i,i,i,i) p .r2"
  System::Call "user32::GetClientRect(p $0, p r2)"
  System::Call "*$2(i,i,i,i .r3)"
  System::Free $2
  IntOp $3 $3 / 3

  GetDlgItem $1 $0 1004
  System::Call "user32::SetWindowPos(p $1, p 0, i 0, i $3, i 0, i 0, i 0x0015)"

  IntOp $4 $3 - 22
  GetDlgItem $1 $0 1006
  System::Call "user32::SetWindowPos(p $1, p 0, i 0, i $4, i 0, i 0, i 0x0015)"
FunctionEnd

/**
 * The one control on the finish page that MUI does not colour for us.
 *
 * `SetCtlColors` alone does nothing to a checkbox: with visual styles on, the
 * theme engine draws the control including its label and never asks the parent
 * what colour to use, so the caption stayed black on our near-black background
 * — a checkbox with no readable label beside it. Detaching the control from the
 * theme first is what puts it back under the parent's control, at the cost of
 * the checkbox glyph being drawn the classic way rather than the modern one.
 */
Function rpFinishShow
  /**
   * Two dialogs down, not one.
   *
   * The welcome and finish pages are not drawn by MUI directly — they are
   * InstallOptions dialogs, built from an INI and parented *inside* the page's
   * own dialog. The usual `FindWindow` idiom lands on the page, whose children
   * are not the fields; asking it for a checkbox returned nothing, and every
   * control id tried against it was a silent no-op.
   */
  FindWindow $0 "#32770" "" $HWNDPARENT
  FindWindow $0 "#32770" "" $0

  ; Every control the page might have rather than the one it should: MUI builds
  ; this page from an INI whose field order — and so the control ids — depends
  ; on which fields are in use, and electron-builder's sidebar occupies one.
  !insertmacro rpRepaint 1200
  !insertmacro rpRepaint 1201
  !insertmacro rpRepaint 1202
  !insertmacro rpRepaint 1203
  !insertmacro rpRepaint 1204
  !insertmacro rpRepaint 1205
  !insertmacro rpRepaint 1206
FunctionEnd
!endif

/**
 * The mark, unpacked where the page can reach it.
 *
 * nsDialogs loads images from disk, and the installer's own resources are not
 * on disk until something puts them there. `$PLUGINSDIR` is the scratch folder
 * NSIS makes for exactly this and clears up on exit.
 */
!macro customInit
  InitPluginsDir
  File /oname=$PLUGINSDIR\rpMark.bmp "${BUILD_RESOURCES_DIR}\installerMark.bmp"
!macroend
