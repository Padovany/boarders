' Keeps WSL Ubuntu (and its Docker engine, which runs Boarders) alive while you're logged in.
' WSL stops a distro once nothing is attached to it, and sleep/hibernate can kill it outright,
' so this hidden loop re-attaches whenever the previous session ends.
' Installed in shell:startup. To undo: delete it there and end the wscript.exe process.
Set sh = CreateObject("WScript.Shell")
Do
    sh.Run "wsl.exe -d Ubuntu --exec sleep infinity", 0, True
    WScript.Sleep 15000
Loop
