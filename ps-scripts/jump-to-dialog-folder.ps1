# Paste a folder path into the active Windows file dialog.
#
# History:
#   v1: SendKeys($path) — broken, multi-byte Korean got mangled by IME stack.
#   v2: SendKeys("^v") with clipboard — Korean fixed BUT WScript.Shell.SendKeys
#       has a long-known .NET bug: it desyncs the NumLock toggle state on most
#       systems. After a paste the user's keyboard reports NumLock as on/off
#       inconsistent with the LED, the numpad starts emitting arrow keys, etc.
#       (Microsoft docs literally say "For some strange reason, SendKeys turns
#       the NumLock key off.")
#   v3 (this version): direct keybd_event calls, NO SendKeys involvement at
#       all. The OS-level keyboard state stays untouched, so NumLock /
#       CapsLock / ScrollLock all keep whatever state the user had.
#
# Sequence:
#   1. (optionally) bring the target dialog HWND to the foreground —
#      defensive, in case the user clicked the nost popup or another app
#      between opening the dialog and clicking a folder chip.
#   2. Save the user's text clipboard.
#   3. Put the target path on the clipboard (UTF-16 native — Korean safe).
#   4. Send Ctrl+L → Ctrl+A → Ctrl+V → Enter via keybd_event.
#   5. After ~350 ms restore the prior clipboard.

. "$PSScriptRoot\_Win32Types.ps1"

Add-Type -AssemblyName System.Windows.Forms -ErrorAction SilentlyContinue

$path = $env:QL_PATH
if (-not $path) { exit 1 }

# ── Foreground the target dialog (best-effort) ───────────────────────
$hwndArg = $env:QL_DIALOG_HWND
if ($hwndArg) {
    try {
        $h = [int64]$hwndArg
        if ($h -ne 0) {
            [NostWin32]::SetForegroundWindow([IntPtr]$h) | Out-Null
            Start-Sleep -Milliseconds 60
        }
    } catch { }
}

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
    exit 2
}

# ── Direct key events ────────────────────────────────────────────────
# Virtual-Key codes (https://learn.microsoft.com/windows/win32/inputdev/virtual-key-codes)
$VK_CONTROL = [byte]0x11
$VK_L       = [byte]0x4C
$VK_A       = [byte]0x41
$VK_V       = [byte]0x56
$VK_RETURN  = [byte]0x0D
$KEYUP      = [uint32]2

function Send-Combo {
    param([byte]$mod, [byte]$key)
    [NostWin32]::keybd_event($mod, 0, 0,        [UIntPtr]::Zero); Start-Sleep -Milliseconds 8
    [NostWin32]::keybd_event($key, 0, 0,        [UIntPtr]::Zero); Start-Sleep -Milliseconds 8
    [NostWin32]::keybd_event($key, 0, $KEYUP,   [UIntPtr]::Zero); Start-Sleep -Milliseconds 8
    [NostWin32]::keybd_event($mod, 0, $KEYUP,   [UIntPtr]::Zero)
}
function Send-Single {
    param([byte]$key)
    [NostWin32]::keybd_event($key, 0, 0,        [UIntPtr]::Zero); Start-Sleep -Milliseconds 8
    [NostWin32]::keybd_event($key, 0, $KEYUP,   [UIntPtr]::Zero)
}

# Ctrl+L (focus address bar in Win10/11 file dialogs and Explorer).
Send-Combo $VK_CONTROL $VK_L
Start-Sleep -Milliseconds 90

# Ctrl+A (clear whatever was there — defensive; most dialogs auto-select on focus).
Send-Combo $VK_CONTROL $VK_A
Start-Sleep -Milliseconds 30

# Ctrl+V (paste path — Unicode safe via clipboard).
Send-Combo $VK_CONTROL $VK_V
Start-Sleep -Milliseconds 60

# Enter (commit navigation).
Send-Single $VK_RETURN

# ── Restore prior clipboard ──────────────────────────────────────────
Start-Sleep -Milliseconds 350
if ($null -ne $prevClip) {
    try { [System.Windows.Forms.Clipboard]::SetText($prevClip) } catch { }
}
