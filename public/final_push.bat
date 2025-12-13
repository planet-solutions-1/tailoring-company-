@echo off
echo ====================================================
echo  FINAL PUSH - PLANET SOLUTIONS
echo ====================================================
echo.
echo Staging files...
git add .
echo.
echo Committing...
git commit -m "Final Deploy v2 - %date% %time%"
echo.
echo Pushing to GitHub...
echo (Please enter your PAT/Password if prompted)
echo.
git push https://planet-solutions-1@github.com/planet-solutions-1/tailoring-company-.git main
echo.
echo DONE! Check Railway for 'Sign In (v2)'.
pause
