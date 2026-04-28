# Jump a Windows file dialog (Save-As / Open) to the requested folder.
#
# OLD APPROACH (broken for Korean / Unicode paths):
#   SendKeys("^l")           -> focus address bar
#   SendKeys($env:QL_PATH)   -> type the path character-by-character
#   SendKeys("{ENTER}")
#
#   `SendKeys` simulates raw keystrokes, which on Korean Windows go through
#   the IME composition stack — multi-byte characters get mangled, special
#   characters (~, +, ^, %, () etc.) are interpreted as SendKeys metacommands,
#   and the dialog's filename field ends up with garbage like "52_X" or just
#   a few latin letters.
#
# NEW APPROACH (this script):
#   1. Save the user's current clipboard (text only — we don't try to round-
#      trip image / file-list clipboard payloads, those edge cases are rare
#      enough that "you lose your clipboard for a second" is acceptable).
#   2. Put the target path on the clipboard. The clipboard is native UTF-16,
#      so Korean / emoji / any Unicode survives intact.
#   3. Send Ctrl+L (focus address bar — works on Windows 10/11 file dialogs
#      AND Explorer windows; same shortcut as browsers).
#   4. Send Ctrl+A then Ctrl+V (clear whatever was there, then paste).
#   5. Send Enter (commit — dialog navigates to the folder).
#   6. After ~350 ms (long enough for the paste to be consumed) restore the
#      user's previous clipboard so they don't lose what they had copied.
#
# Tradeoff: Ctrl+L may not focus the address bar in *every* dialog (some
# legacy / restricted apps lack one). In that case the paste lands in
# whatever field has focus. The Windows file-name combobox accepts a full
# path + Enter and navigates to it, so the fallback usually still works —
# the user just sees the path appear in the file name field instead of the
# address bar.

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

$path = $env:QL_PATH
if (-not $path) { exit 1 }

# ── Save existing clipboard ──────────────────────────────────────────
$prevClip = $null
try {
    if ([System.Windows.Forms.Clipboard]::ContainsText()) {
        $prevClip = [System.Windows.Forms.Clipboard]::GetText()
    }
} catch { }

# ── Put the path on the clipboard ────────────────────────────────────
try {
    [System.Windows.Forms.Clipboard]::SetText($path)
} catch {
    # Clipboard busy (rare — another app has it locked). Bail; the user
    # will see no nav happen and can click again.
    exit 2
}

$shell = New-Object -ComObject WScript.Shell
Start-Sleep -Milliseconds 60

# Focus the address bar.
$shell.SendKeys("^l")
Start-Sleep -Milliseconds 90

# Select whatever's there (defensive — most dialogs auto-select on focus).
$shell.SendKeys("^a")
Start-Sleep -Milliseconds 30

# Paste — clipboard delivers Unicode intact.
$shell.SendKeys("^v")
Start-Sleep -Milliseconds 60

# Commit.
$shell.SendKeys("{ENTER}")

# ── Restore prior clipboard ──────────────────────────────────────────
# Wait long enough for the dialog to actually consume the paste before we
# clobber the clipboard. 350 ms is empirically safe across Win10/11 file
# dialogs; below ~250 ms a slow dialog occasionally races us and ends up
# pasting the restored value instead of our path.
Start-Sleep -Milliseconds 350
if ($null -ne $prevClip) {
    try { [System.Windows.Forms.Clipboard]::SetText($prevClip) } catch { }
}
