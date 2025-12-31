@echo off
echo ====================================================
echo  DEPLOY FIX FINAL
echo ====================================================
echo.
echo Forcing add of server/config/db.js...
git add server/config/db.js
git add .
echo.
echo Committing fix...
git commit -m "Fix: Add mock serialize for MySQL adapter" --allow-empty
echo.
echo Pushing...
git push origin main
echo.
echo DONE!
pause
