function validateBooking(req, res, next) {
  const { slotId, patientName, patientEmail, reason } = req.body;
  const errors = [];

  if (!slotId) {
    errors.push('slotId is required');
  }

  if (!patientName) {
    errors.push('patientName is required');
  }

  if (!patientEmail) {
    errors.push('patientEmail is required');
  } else {
    // Basic email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(patientEmail)) {
      errors.push('patientEmail must be a valid email address');
    }
  }

  if (errors.length > 0) {
    return res.status(400).json({
      status: 'error',
      message: 'Validation failed',
      errors,
    });
  }

  next();
}

module.exports = { validateBooking };
