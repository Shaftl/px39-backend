// backend/middleware/role.middleware.js

/**
 * permitRoles(...allowedRoles)
 * Usage: router.use(authMiddleware, permitRoles('admin'))
 * Accepts either multiple args or an array: permitRoles('admin','moderator') or permitRoles(['admin'])
 */
function permitRoles(...allowedRoles) {
  // support permitRoles(['admin']) or permitRoles('admin')
  if (allowedRoles.length === 1 && Array.isArray(allowedRoles[0])) {
    allowedRoles = allowedRoles[0];
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ message: "Unauthorized" });
    }
    const role = req.user.role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ message: "Forbidden: insufficient role" });
    }
    return next();
  };
}

module.exports = permitRoles;
