@echo off
title Connecter Moodle a mon assistant
"%~dp0polymtl-moodle-connect.exe" install
if errorlevel 1 (
  echo.
  echo Installation incomplete. Consultez README.md pour obtenir de l'aide.
)
echo.
pause
