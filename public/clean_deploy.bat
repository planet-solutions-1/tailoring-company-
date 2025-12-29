@echo off
echo ====================================================
echo  CLEAN REPO & DEPLOY (v5)
echo ====================================================
echo.
echo Removing node_modules from git tracking (cached only)...
git rm -r --cached node_modules
echo.
echo Committing cleanup...
git add .
git commit -m "Fix: Lazy load sqlite3 and remove node_modules from git"
echo.
echo Pushing fixes...
git push -u origin main
echo.
echo DONE!
pause
