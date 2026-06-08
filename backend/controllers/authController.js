import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { supabase } from '../config/supabase.js';
import logger from '../utils/logger.js';
import { loginSchema, logoutSchema, signupSchema, updatePasswordSchema } from '../contracts/authContracts.js';
import { getContractErrorMessage, parseWithSchema } from '../utils/contractValidation.js';
import { requireAuthentication as authenticateToken } from '../middleware/authMiddleware.js';

const router = express.Router();
const console = {
  log: (...args) => logger.debug(...args),
  warn: (...args) => logger.warn(...args),
  error: (...args) => logger.error(...args)
};

// JWT utility functions
const signToken = (id) => {
  return jwt.sign({ id }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  });
};

const createSendToken = (user, statusCode, res) => {
  const token = signToken(user.id);
  
  res.status(statusCode).json({
    status: 'success',
    token,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      userType: user.user_type,
      company: user.company,
      phone: user.phone,
      isActive: user.is_active,
      emailVerified: user.email_verified,
      lastLogin: user.last_login,
      createdAt: user.created_at
    }
  });
};

// Helper function to hash password
const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

// Helper function to compare password
const comparePassword = async (candidatePassword, hashedPassword) => {
  return await bcrypt.compare(candidatePassword, hashedPassword);
};

function buildSignupAddress(userType, companyName = '') {
  if (!['supplier', 'service_provider'].includes(String(userType || '').trim().toLowerCase())) {
    return null;
  }
  const fallbackLine1 = String(companyName || '').trim() || 'Address pending';
  // Signup does not collect full address fields yet; keep placeholder values
  // so DB check constraint passes and user can complete real address in profile.
  return {
    line1: fallbackLine1,
    city: 'Pending',
    state: 'Pending',
    pincode: '000000',
    country: 'India'
  };
}

// Register new user (signup)
router.post('/signup', async (req, res) => {
  try {
    const payload = parseWithSchema(signupSchema, req.body || {});
    const { name, email, password, userType, company, phone } = payload;
    const normalizedEmail = String(email || '').trim().toLowerCase();
    const normalizedName = String(name || '').trim();
    const normalizedUserType = String(userType || '').trim().toLowerCase();

    if (!normalizedName || !normalizedEmail || !password || !normalizedUserType) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, email, password and userType are required'
      });
    }

    if (!['supplier', 'service_provider'].includes(normalizedUserType)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid userType. Allowed values: supplier, service_provider'
      });
    }

    // Check if user already exists
    const { data: existingUser } = await supabase
      .from('users')
      .select('id')
      .eq('email', normalizedEmail)
      .single();

    if (existingUser) {
      return res.status(400).json({
        status: 'error',
        message: 'User with this email already exists'
      });
    }

    // Hash password
    const hashedPassword = await hashPassword(password);

    // Create new user
    console.log(' Creating new user:', {
      name: normalizedName,
      email: normalizedEmail,
      userType: normalizedUserType,
      company: company || 'N/A',
      phone: phone || 'N/A'
    });

    const { data: newUser, error } = await supabase
      .from('users')
      .insert({
        name: normalizedName,
        email: normalizedEmail,
        password: hashedPassword,
        user_type: normalizedUserType,
        company,
        phone,
        address: buildSignupAddress(normalizedUserType, company),
        is_active: true,
        email_verified: false
      })
      .select()
      .single();

    if (error) {
      console.error('Registration error:', error);
      console.error('Error details:', {
        code: error.code,
        message: error.message,
        details: error.details,
        hint: error.hint
      });
      const isProduction = process.env.NODE_ENV === 'production';
      return res.status(400).json({
        status: 'error',
        message: isProduction ? 'Error creating user account' : (error.message || 'Error creating user account'),
        ...(isProduction ? {} : { error: error.code || 'UNKNOWN_ERROR' })
      });
    }

    if (!newUser) {
      console.error('User creation returned no data');
      return res.status(500).json({
        status: 'error',
        message: 'User account created but data not returned'
      });
    }

    console.log('User created successfully:', {
      id: newUser.id,
      name: newUser.name,
      email: newUser.email,
      user_type: newUser.user_type,
      created_at: newUser.created_at
    });

    // Send token
    createSendToken(newUser, 201, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Registration error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error creating user account'
    });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const payload = parseWithSchema(loginSchema, req.body || {});
    const { email, password } = payload;

    // Check for admin email from environment variables
    const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
    const initialAdminPassword = process.env.ADMIN_PASSWORD;
    
    if (process.env.NODE_ENV !== 'production') {
      console.log('Login attempt for email:', email.toLowerCase());
    }

    // If this is the admin email, handle admin login
    if (email.toLowerCase() === adminEmail.toLowerCase()) {
      let { data: adminUser, error: adminError } = await supabase
        .from('users')
        .select('*')
        .eq('email', adminEmail.toLowerCase())
        .single();
      
      // If admin user doesn't exist and we have initial password from env, create it
      if (!adminUser && initialAdminPassword) {
        try {
          const hashedPassword = await hashPassword(initialAdminPassword);
          const { data: newAdmin, error: createError } = await supabase
            .from('users')
            .insert({
              name: process.env.ADMIN_NAME || 'Admin User',
              email: adminEmail.toLowerCase(),
              password: hashedPassword,
              user_type: 'admin',
              company: process.env.ADMIN_COMPANY || 'Tatva Direct',
              email_verified: true,
              is_active: true
            })
            .select()
            .single();
          
          if (createError) {
            console.error('Error creating admin user:', createError);
            return res.status(500).json({
              status: 'error',
              message: 'Error creating admin account. Please check server logs.'
            });
          }
          
          adminUser = newAdmin;
        } catch (createError) {
          console.error('Error creating admin user:', createError);
          return res.status(500).json({
            status: 'error',
            message: 'Error creating admin account. Please check server logs.'
          });
        }
      }
      
      // If admin user exists, verify password
      if (adminUser) {
        // Ensure user type is admin
        if (adminUser.user_type !== 'admin') {
          await supabase
            .from('users')
            .update({ user_type: 'admin' })
            .eq('id', adminUser.id);
          adminUser.user_type = 'admin';
        }
        
        // Verify password
        const isPasswordCorrect = await comparePassword(password, adminUser.password);
        
        // If password doesn't match and we have initial password from env, 
        // allow reset if the provided password matches the env password
        if (!isPasswordCorrect && initialAdminPassword && password === initialAdminPassword) {
          const hashedPassword = await hashPassword(initialAdminPassword);
          const { data: updatedAdmin, error: updateError } = await supabase
            .from('users')
            .update({ password: hashedPassword })
            .eq('id', adminUser.id)
            .select()
            .single();
          
          if (updateError) {
            console.error('Error updating admin password:', updateError);
            return res.status(500).json({
              status: 'error',
              message: 'Error updating admin password'
            });
          }
          
          adminUser = updatedAdmin;
        } else if (!isPasswordCorrect) {
          return res.status(401).json({
            status: 'error',
            message: 'Incorrect email or password. Please check your credentials.'
          });
        }
        
        // Final password verification
        const finalPasswordCheck = await comparePassword(password, adminUser.password);
        if (!finalPasswordCheck) {
          return res.status(401).json({
            status: 'error',
            message: 'Incorrect email or password. Please check your credentials.'
          });
        }
        
        // Check if user is active
        if (!adminUser.is_active) {
          return res.status(401).json({
            status: 'error',
            message: 'Your account has been deactivated. Please contact support.'
          });
        }
        
        console.log('Admin login successful');
        return createSendToken(adminUser, 200, res);
      } else {
        // Admin email but no admin user and no initial password set
        console.log('Admin user not found and no password in env');
        return res.status(401).json({
          status: 'error',
          message: 'Admin account not configured. Please set ADMIN_PASSWORD in environment variables.'
        });
      }
    }

    // 2) Check if user exists and password is correct
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('email', email.toLowerCase())
      .single();

    if (userError || !user) {
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect email or password'
      });
    }

    // Verify password
    const isPasswordCorrect = await comparePassword(password, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        status: 'error',
        message: 'Incorrect email or password'
      });
    }

    // 3) Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        status: 'error',
        message: 'Your account has been deactivated. Please contact support.'
      });
    }

    // 4) If everything ok, send token to client
    createSendToken(user, 200, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Login error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error during login'
    });
  }
});

// Get current user profile
router.get('/profile', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Remove password from response
    delete user.password;
    
    res.status(200).json({
      status: 'success',
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching user data'
    });
  }
});

// Get current user (alternative endpoint)
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();
    
    if (error || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }
    
    // Remove password from response
    delete user.password;
    
    res.status(200).json({
      status: 'success',
      user
    });
  } catch (error) {
    console.error('Get user error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error fetching user data'
    });
  }
});

// Update password
router.patch('/update-password', authenticateToken, async (req, res) => {
  try {
    const payload = parseWithSchema(updatePasswordSchema, req.body || {});
    const { currentPassword, newPassword } = payload;

    // 1) Get user from collection
    const { data: user, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('id', req.userId)
      .single();

    if (userError || !user) {
      return res.status(404).json({
        status: 'error',
        message: 'User not found'
      });
    }

    // 2) Check if current password is correct
    const isPasswordCorrect = await comparePassword(currentPassword, user.password);
    if (!isPasswordCorrect) {
      return res.status(401).json({
        status: 'error',
        message: 'Your current password is incorrect'
      });
    }

    // 3) Hash new password
    const hashedPassword = await hashPassword(newPassword);

    // 4) Update password
    const { data: updatedUser, error: updateError } = await supabase
      .from('users')
      .update({ 
        password: hashedPassword,
        password_changed_at: new Date().toISOString()
      })
      .eq('id', req.userId)
      .select()
      .single();

    if (updateError) {
      return res.status(500).json({
        status: 'error',
        message: 'Error updating password'
      });
    }

    // 5) Log user in, send JWT
    createSendToken(updatedUser, 200, res);
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
    console.error('Update password error:', error);
    res.status(500).json({
      status: 'error',
      message: 'Error updating password'
    });
  }
});

// Logout (client-side token removal)
router.post('/logout', (req, res) => {
  try {
    parseWithSchema(logoutSchema, req.body || {});
  } catch (error) {
    if (String(error?.name || '') === 'ZodError') {
      return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
    }
  }
  res.status(200).json({
    status: 'success',
    message: 'Logged out successfully'
  });
});

export { router as authRouter };
