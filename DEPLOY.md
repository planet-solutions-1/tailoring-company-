# 🚀 Deploying to Railway

This application is fully configured for deployment on [Railway.app](https://railway.app/). It supports automatic switching between **SQLite** (Local) and **MySQL** (Production/Railway).

## Prerequisites
- A GitHub account.
- A [Railway](https://railway.app/) account (Free tier available).

## Step-by-Step Deployment Guide

### 1. Push Code to GitHub
Ensure this project is pushed to a GitHub repository.

### 2. Create a New Project on Railway
1. Log in to Railway.
2. Click **+ New Project** > **Deploy from GitHub repo**.
3. Select your repository (`planet-editor`).
4. Click **Deploy Now**.

### 3. Add a Database (MySQL)
The application requires a MySQL database for production environment.
1. In your Railway project view, click **+ New** > **Database** > **MySQL**.
2. Wait for the MySQL service to initialize.

### 4. Connect App to Database
1. Click on your **App Service** (the Node.js one).
2. Go to the **Variables** tab.
3. You need to add the `DATABASE_URL` variable.
   - Click **Reference Variable**.
   - Select `MYSQL_URL` (from the MySQL service you just created).
   - Rename the key to `DATABASE_URL` if it isn't already, or just ensure your app looks for `MYSQL_URL` (Our code looks for `DATABASE_URL`).
   
   *Tip: Railway often automatically injects `DATABASE_URL` if you link the services, but verifying is good.*

4. Add these additional variables:
   - `NODE_ENV`: `production`
   - `RAILWAY_ENVIRONMENT`: `true`
   - `JWT_SECRET`: (Generate a long random string for security)

### 5. Verify Deployment
1. Go to the **Deployments** tab.
2. You should see a "Building" and then "Active" deployment.
3. Click the generated URL (e.g., `https://planet-editor-production.up.railway.app`).

## Troubleshooting
- **Database Connection Error**: Check the `Deploy Logs`. Ensure `DATABASE_URL` is correct.
- **502 Bad Gateway**: Check if the app crashed. Look for "Listen EADDRINUSE" (rare on Railway) or syntax errors in logs.
- **Port**: Railway automatically sets `PORT`. Our app listens on `process.env.PORT` or `3000`, so this is handled.

## Database Schema
The application includes an **Auto-Migration** script.
- On the first run, it will automatically create all necessary tables (`schools`, `users`, `students`, etc.) in your MySQL database.
- You do **not** need to manually run SQL scripts.
- Check the logs for `MySQL Tables Initialized`.

## Default Login
On fresh deployment, the system will create a default admin user:
- **Username**: `admin`
- **Password**: `admin123`
- **Login URL**: `/login` (e.g., `https://your-app.up.railway.app/login`)

**Security Note**: Change this password immediately after first login!

## 🛠️ v1.2.0 Verification (Critical)
If you are debugging login issues, follow this exact procedure:

1.  **Deploy** the latest code.
2.  **Wait** for the deployment to finish.
3.  **Open Login Page**.
4.  **Check the Footer**: You **MUST** see `v1.2.0` in small text.
    - If you do *not* see `v1.2.0`, the deployment failed or is cached. **Do not proceed.**

### 🔑 Super Admin Logic (Safety Net)
If standard login fails, use the Hardcoded / Database-Injected Super Admin:
- **Username**: `anson_admin`
- **Password**: `masterkey_2026`

*This user is automatically created in the database on server startup if it doesn't exist.*
