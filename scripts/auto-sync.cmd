@echo off
rem Aether media sync — run by the "Aether Media Sync" scheduled task.
cd /d "D:\aether"
"C:\Program Files\nodejs\node.exe" --env-file="D:\aether\.env.local" "D:\aether\scripts\sync-media.mjs" >> "D:\aether\sync-media.log" 2>&1
