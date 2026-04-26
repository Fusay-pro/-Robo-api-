function badRequest(res, message) {
  return res.status(400).json({ error: message });
}
function unauthorized(res, message = 'Unauthorized') {
  return res.status(401).json({ error: message });
}
function forbidden(res, message = 'Forbidden') {
  return res.status(403).json({ error: message });
}
function notFound(res, message = 'Not found') {
  return res.status(404).json({ error: message });
}
function conflict(res, message) {
  return res.status(409).json({ error: message });
}
function serverError(res, message = 'Internal server error') {
  return res.status(500).json({ error: message });
}

module.exports = { badRequest, unauthorized, forbidden, notFound, conflict, serverError };
