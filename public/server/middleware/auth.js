const jwt = require('jsonwebtoken');

function authenticateToken(req, res, next) {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (token == null) return res.sendStatus(401); // No Token

    jwt.verify(token, 'hardcoded_secret_key_fixed', (err, user) => {
        if (err) return res.sendStatus(403); // Invalid Token
        req.user = user;
        next();
    });
}

function requireRole(role) {
    return (req, res, next) => {
        if (req.user.role !== role && req.user.role !== 'company') { // Company is superadmin
            return res.sendStatus(403);
        }
        next();
    }
}

module.exports = { authenticateToken, requireRole };
