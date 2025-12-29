@echo off
echo ====================================================
echo  FINAL PUSH V4 (FIXED)
echo ====================================================
echo.
echo NOTE: Staging all changes and forcing update.
echo.
git add -A
git commit -m "Fixed Dashboard Links and Database Sync Integration"
echo.
echo Pushing...
git push -u origin main
echo.
echo DONE!
pause
