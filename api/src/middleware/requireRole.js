//checks wheather someone is allowed to do something

function requireRole(...allowed) {
    return (req, res, next) => {
        if (!allowed.includes(req.ctx.role)) {
            //403-login but not allowed
            return res.status(403).json({
                data: null,
                error: { message: 'Insufficient permissions', code: 'FORBIDDEN' }
            });
        }
        //carry on on the other route
        next();
    };
}

module.exports = { requireRole };