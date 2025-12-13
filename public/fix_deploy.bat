@echo off
echo ==========================================
echo      PLANET SOLUTIONS - DEPLOY FIX
echo ==========================================
echo.
echo [1/4] Moving to Project Root...
cd ..
echo Current Directory: %CD%
echo.
echo [2/4] Staging ALL files (Root + Public)...
git add .
echo.
echo [3/4] Committing Deployment Config...
git commit -m "Fix: Update Procfile and Start Script for Railway"
echo.
echo [4/4] Pushing to GitHub...
git push -u origin main -f
echo.
echo ==========================================
echo      DEPLOYMENT FIXED - CHECK RAILWAY
echo ==========================================
pause
