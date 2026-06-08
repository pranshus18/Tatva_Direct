import express from 'express';
import { registerProfileReadRoutes } from './profile/routes/readRoutes.js';
import { registerProfileThemeRoutes } from './profile/routes/themeRoutes.js';
import { registerProfileUpdateRoutes } from './profile/routes/updateRoutes.js';
import { registerProfileCertificateRoutes } from './profile/routes/certificateRoutes.js';
import { registerProfilePhotoRoutes } from './profile/routes/photoRoutes.js';

const router = express.Router();

registerProfileReadRoutes(router);
registerProfileThemeRoutes(router);
registerProfileUpdateRoutes(router);
registerProfileCertificateRoutes(router);
registerProfilePhotoRoutes(router);

export { router as profileRouter };
