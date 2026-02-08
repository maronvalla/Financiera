Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:FIREBASE_TOOLS_DISABLE_UPDATE_CHECK="1"

firebase deploy --only hosting,functions
