import express from 'express';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';
import { generateInvoiceByOrder, getInvoiceByOrder } from '../controllers/invoiceController.js';

const router = express.Router();

// Get invoice for an order (service provider OR supplier that belongs to the order)
router.get('/order/:id', authenticateToken, getInvoiceByOrder);

// Generate an invoice for an order (id or order_number)
router.post('/order/:id/generate', authenticateToken, generateInvoiceByOrder);

export { router as invoicesRouter };

