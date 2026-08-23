function requireRole(...allowed) {
    return (req, res, next) => {
        if (!allowed.includes(req.ctx.role)) {
            return res.status(403).json({
                data: null,
                error: { message: 'Insufficient permissions', code: 'FORBIDDEN' }
            });
        }
        next();
    };
}

module.exports = { requireRole };