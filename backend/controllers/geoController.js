import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { lookupIndianPincode, parseOptionalGeo, reverseGeocodeCoordinates } from '../utils/geoUtils.js';

const router = express.Router();

router.get('/reverse', authenticateToken, async (req, res) => {
  try {
    const geo = parseOptionalGeo(req.query.lat, req.query.lng);
    if (!geo) {
      return res.status(400).json({
        status: 'error',
        message: 'Valid lat and lng query parameters are required.'
      });
    }

    const address = await reverseGeocodeCoordinates(geo.lat, geo.lng);
    if (!address) {
      return res.status(404).json({
        status: 'error',
        message: 'Could not resolve an address for your current location.'
      });
    }

    return res.json({
      status: 'success',
      address
    });
  } catch (error) {
    console.error('[Geo reverse] error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to resolve your current location.'
    });
  }
});

router.get('/pincode/:pincode', authenticateToken, async (req, res) => {
  try {
    const address = await lookupIndianPincode(req.params.pincode);
    if (!address) {
      return res.status(404).json({
        status: 'error',
        message: 'Could not resolve address details for this pincode.'
      });
    }
    return res.json({
      status: 'success',
      address
    });
  } catch (error) {
    console.error('[Geo pincode] error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to look up this pincode.'
    });
  }
});

export { router as geoRouter };
