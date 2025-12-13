@echo off
echo ====================================================
echo  PUSHING UPDATES TO GITHUB
echo ====================================================
echo.
git add .
git commit -m "Fix Railway DB Tables"
echo.
echo You will be asked for your GitHub Personal Access Token (or Password).
echo.
git push https://planet-solutions-1@github.com/planet-solutions-1/tailoring-company-.git main
echo.
pause
