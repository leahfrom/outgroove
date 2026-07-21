$ErrorActionPreference = "Stop"

$path = $args[0]
$stream = [System.IO.File]::Open(
  $path,
  [System.IO.FileMode]::Open,
  [System.IO.FileAccess]::ReadWrite,
  [System.IO.FileShare]::None
)

try {
  [Console]::Out.WriteLine("OUTGROOVE_LOCKED")
  [Console]::Out.Flush()
  [Console]::In.ReadLine() | Out-Null
}
finally {
  $stream.Dispose()
}
