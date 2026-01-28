const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    let token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    // Fallback to Cookie (for Browser Dashboard)
    if (!token && req.cookies && req.cookies.token) {
        token = req.cookies.token;
    }

    if (token == null) return res.sendStatus(401); // No Token

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err) {
            console.error("Auth Middleware: JWT Verify Error", err.message);
            return res.sendStatus(403); // Invalid Token
        }
        req.user = user;
        // console.log("Auth Middleware_Success:", user.username, user.role);
        next();
    });
}

function requireRole(role) {
    return (req, res, next) => {
        console.log(`Role Check: Required=${role}, UserRole=${req.user?.role}`);
        if (req.user.role !== role && req.user.role !== 'company') { // Company is superadmin
            console.error(`Role Check FAILED: User ${req.user.username} is ${req.user.role}, needs ${role}`);
            return res.sendStatus(403);
        }
        next();
    }
}

module.exports = { authenticateToken, requireRole };
