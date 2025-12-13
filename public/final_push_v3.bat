@echo off
echo ====================================================
echo  FINAL PUSH V3 (FORCE OVERWRITE)
echo ====================================================
echo.
echo NOTE: This will overwrite the GitHub version with your Local version.
echo This is necessary because they got out of sync.
echo.
git add .
git commit -m "Force Update v3 - Resolved Rejection"
echo.
echo Pushing with FORCE option...
git push -f https://planet-solutions-1@github.com/planet-solutions-1/tailoring-company-.git main
echo.
echo DONE! Look for 'Sign In (v3)'.
pause
