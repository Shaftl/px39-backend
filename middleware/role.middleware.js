// backend/middleware/role.middleware.js

/**
 * permitRoles(...allowedRoles)
 * Usage: router.get('/admin', authMiddleware, permitRoles('admin'), handler)
 */
function permitRoles(...allowedRoles) {
  return (req, res, next) => {
    // req.user is set by authMiddleware
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    next();
  };
}

module.exports = permitRoles;
