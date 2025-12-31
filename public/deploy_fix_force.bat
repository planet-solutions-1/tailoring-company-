@echo off
echo ====================================================
echo  DEPLOY FIX FORCE (v2)
echo ====================================================
echo.
echo Forecfully adding server/config/db.js...
git add --force server/config/db.js
git add .
echo.
echo Committing fix...
git commit -m "Fix: Force update db.js with serialize mock"
echo.
echo Pushing...
git push origin main
echo.
echo DONE!
pause
