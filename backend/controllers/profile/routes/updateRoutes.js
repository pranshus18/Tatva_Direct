import { v4 as uuidv4 } from 'uuid';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import {
  baselineChainFromProfile,
  buildChainPayloadFromProfileData,
  chainPayloadSignature,
  clearPendingChainRequest,
  hasAnySupplyChainRole,
  replacePendingChainRequest
} from '../../../services/supplierChainProfileService.js';
import { insertNotifications } from '../../../repositories/notificationsRepository.js';
import { findAdmins } from '../../../repositories/usersRepository.js';
import { profileUpdateSchema } from '../../../contracts/profileContracts.js';
import {
  isSupplierBranchAddressComplete,
  primaryBranchToUsersAddress
} from '../../../services/upstreamOrderInputService.js';
import { getContractErrorMessage, parseWithSchema } from '../../../utils/contractValidation.js';
import {
  resolveCompanyInfoEntriesForValidation,
  supplierProfileIncludesChainDraft,
  validateCompanyInfoEntriesList
} from '../../../utils/supplierChainEntryValidation.js';
import {
  createProfileResponse,
  ensureBrandApprovedOrRequest,
  parseBrandTokens,
  resolveChainRoleOptionsForBrands
} from '../profileHelpers.js';

export function registerProfileUpdateRoutes(router) {
  router.put('/', authenticateToken, async (req, res) => {
    try {
      const profileData = parseWithSchema(profileUpdateSchema, req.body || {});

      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({
          status: 'error',
          message: 'User not found'
        });
      }

      const updateData = {
        company: profileData.companyName,
        phone: profileData.phone
      };

      // Suppliers sync users.address from profile.branches (see supplier block below).
      if (profileData.address && profileData.userType !== 'supplier') {
        updateData.address = {
          ...(currentUser.address || {}),
          ...profileData.address
        };
      }

      const currentProfile = currentUser.profile || {};
      const profileUpdate = {
        ...currentProfile,
        website: profileData.website,
        description: profileData.description
      };

      let chainApprovalPending = false;

      if (profileData.userType === 'service_provider') {
        const mergedAddress = {
          ...(currentUser.address || {}),
          ...(profileData.address || {})
        };
        const requiredAddressFields = ['line1', 'city', 'state', 'pincode', 'country'];
        const missingField = requiredAddressFields.find(
          (field) => !String(mergedAddress?.[field] || '').trim()
        );
        if (missingField) {
          return res.status(400).json({
            status: 'error',
            code: 'service_provider_address_required',
            message: `Address field "${missingField}" is required for service provider profile.`
          });
        }

        updateData.address = mergedAddress;
        const billingAddresses = Array.isArray(profileData.billingAddresses)
          ? profileData.billingAddresses.map((entry) => ({
              ...entry,
              id: entry.id || uuidv4()
            }))
          : [];
        const requiredBillingFields = ['line1', 'city', 'state', 'pincode', 'country'];
        for (let i = 0; i < billingAddresses.length; i += 1) {
          const entry = billingAddresses[i] || {};
          const missingBillingField = requiredBillingFields.find(
            (field) => !String(entry?.[field] || '').trim()
          );
          if (missingBillingField) {
            return res.status(400).json({
              status: 'error',
              code: 'service_provider_billing_address_incomplete',
              message: `Billing address ${i + 1} is missing required field "${missingBillingField}".`
            });
          }
        }
        profileUpdate.billingAddresses = billingAddresses;
        delete profileUpdate.gstin;
        delete profileUpdate.panNumber;
        const projects = (profileData.projects || []).map((project) => ({
          ...project,
          id: project.id || uuidv4()
        }));
        profileUpdate.projects = projects;
      } else if (profileData.userType === 'supplier') {
        const branches = (profileData.branches || []).map((branch) => ({
          ...branch,
          id: branch.id || uuidv4()
        }));
        const hasCompleteShippingBranch = branches.some((branch) => isSupplierBranchAddressComplete(branch));
        if (!hasCompleteShippingBranch) {
          return res.status(400).json({
            status: 'error',
            code: 'supplier_shipping_branch_required',
            message:
              'At least one complete branch location (shipping address) is required. Fill address, city, state, PIN, and country.'
          });
        }
        for (let i = 0; i < branches.length; i += 1) {
          const branch = branches[i] || {};
          const hasAnyField = ['address', 'city', 'state', 'zipCode', 'pincode', 'country'].some((field) =>
            String(branch?.[field] || '').trim()
          );
          if (!hasAnyField) continue;
          if (!isSupplierBranchAddressComplete(branch)) {
            const label = String(branch?.name || '').trim() || `Branch ${i + 1}`;
            return res.status(400).json({
              status: 'error',
              code: 'supplier_branch_address_incomplete',
              message: `Branch "${label}" is missing required address fields.`
            });
          }
        }
        profileUpdate.branches = branches;
        updateData.address = primaryBranchToUsersAddress(branches);

        const billingAddresses = Array.isArray(profileData.billingAddresses)
          ? profileData.billingAddresses.map((entry) => ({
              ...entry,
              id: entry.id || uuidv4()
            }))
          : [];
        const requiredBillingFields = ['line1', 'city', 'state', 'pincode', 'country'];
        for (let i = 0; i < billingAddresses.length; i += 1) {
          const entry = billingAddresses[i] || {};
          const missingBillingField = requiredBillingFields.find(
            (field) => !String(entry?.[field] || '').trim()
          );
          if (missingBillingField) {
            return res.status(400).json({
              status: 'error',
              code: 'supplier_billing_address_incomplete',
              message: `Billing address ${i + 1} is missing required field "${missingBillingField}".`
            });
          }
        }
        profileUpdate.billingAddresses = billingAddresses;

        profileUpdate.businessType = profileData.businessType;
        profileUpdate.categories = profileData.categories || [];
        profileUpdate.gstin = profileData.gstin || profileData.mainGstin;
        profileUpdate.ownershipDetails = profileData.ownershipDetails;
        if (profileData.skus !== undefined) {
          profileUpdate.skus = profileData.skus;
        } else if (profileData.skuList !== undefined) {
          profileUpdate.skus = profileData.skuList;
        }
        if (profileData.authorizationCertificateUrl) {
          profileUpdate.authorizationCertificateUrl = profileData.authorizationCertificateUrl;
        }

        const incomingChain = buildChainPayloadFromProfileData(profileData);
        const baselineChain = baselineChainFromProfile(currentProfile);
        const incomingEntries = Array.isArray(incomingChain.companyInfoEntries)
          ? incomingChain.companyInfoEntries
          : [];
        const hasRole =
          incomingEntries.length > 0
            ? incomingEntries.some((e) => String(e?.role || '').trim())
            : hasAnySupplyChainRole(incomingChain);

        if (supplierProfileIncludesChainDraft(profileData)) {
          const chainEntriesForValidation = resolveCompanyInfoEntriesForValidation(profileData);
          const completeness = validateCompanyInfoEntriesList(chainEntriesForValidation);
          if (!completeness.ok) {
            return res.status(400).json({
              status: 'error',
              code: 'supply_chain_entry_incomplete',
              message: completeness.message
            });
          }
        }

        const collectBrandStringsFromChain = (chain) => {
          const brandStrings = [];
          if (typeof chain.brands === 'string') brandStrings.push(chain.brands);
          for (const e of chain.companyInfoEntries || []) {
            if (typeof e?.brands === 'string') brandStrings.push(e.brands);
          }
          return brandStrings;
        };

        const runGlobalBrandGate = async (chain) => {
          if (!hasAnySupplyChainRole(chain)) return null;
          const brandStrings = collectBrandStringsFromChain(chain);
          const uniqueBrands = [
            ...new Set(
              brandStrings
                .flatMap((s) => parseBrandTokens(s))
                .map((b) => b.trim())
                .filter(Boolean)
            )
          ];
          if (uniqueBrands.length === 0) return null;
          const failures = [];
          for (const b of uniqueBrands) {
            const approval = await ensureBrandApprovedOrRequest({
              brandName: b,
              requesterUserId: req.userId
            });
            if (!approval.ok) {
              failures.push({
                brand: b,
                code: approval.code,
                status: approval.brand?.status || null,
                message: approval.message
              });
            }
          }
          return failures.length > 0 ? failures : null;
        };

        if (!hasRole) {
          try {
            await clearPendingChainRequest(req.userId);
          } catch (e) {
            console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
          }
          profileUpdate.supplierRole = incomingChain.supplierRole;
          profileUpdate.brands = incomingChain.brands;
          profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
        } else {
          const brandFailures = await runGlobalBrandGate(incomingChain);
          if (brandFailures) {
            return res.status(403).json({
              status: 'error',
              code: 'brand_approval_required_for_profile',
              message:
                'Some brands in your profile are not approved yet. Requests have been created (if needed). Please wait for admin approval, then save again.',
              brands: brandFailures
            });
          }

          const roleBrandSelections = [];
          const brandSelectionsWithoutRole = [];
          const entriesForValidation = Array.isArray(incomingChain.companyInfoEntries)
            ? incomingChain.companyInfoEntries
            : [];
          for (const e of entriesForValidation) {
            const role = String(e?.role || '').trim();
            const brandsStr = String(e?.brands || '').trim();
            const parsedBrands = parseBrandTokens(brandsStr);
            if (!parsedBrands || parsedBrands.length === 0) continue;
            if (!role) {
              brandSelectionsWithoutRole.push({ brands: parsedBrands });
              continue;
            }
            roleBrandSelections.push({ role, brands: parsedBrands });
          }
          if (
            entriesForValidation.length === 0 &&
            roleBrandSelections.length === 0 &&
            incomingChain.supplierRole
          ) {
            roleBrandSelections.push({
              role: String(incomingChain.supplierRole).trim(),
              brands: parseBrandTokens(incomingChain.brands || '')
            });
          }
          if (
            brandSelectionsWithoutRole.length === 0 &&
            roleBrandSelections.length === 0 &&
            parseBrandTokens(incomingChain.brands || '').length > 0
          ) {
            brandSelectionsWithoutRole.push({
              brands: parseBrandTokens(incomingChain.brands || '')
            });
          }

          // Brand-first flow: when admin chain is not defined yet, allow saving without selecting a role.
          // Once admin chain is available for that brand, role becomes mandatory.
          for (const selection of brandSelectionsWithoutRole) {
            const resolved = await resolveChainRoleOptionsForBrands(selection.brands);
            if (resolved.eligible) {
              return res.status(403).json({
                status: 'error',
                code: 'role_required_after_chain_defined',
                message:
                  'Supply chain is now defined by admin for the selected brand. Please select your supply-chain role before saving.',
                details: {
                  brands: resolved.brands || []
                }
              });
            }
          }

          for (const selection of roleBrandSelections) {
            if (!selection.brands || selection.brands.length === 0) {
              return res.status(403).json({
                status: 'error',
                code: 'chain_role_requires_brand',
                message: 'Select at least one brand before choosing your supply-chain role.'
              });
            }

            const resolved = await resolveChainRoleOptionsForBrands(selection.brands);
            if (!resolved.eligible) {
              return res.status(403).json({
                status: 'error',
                code: 'supply_chain_not_defined_for_selected_brand',
                message:
                  resolved.message ||
                  'Admin has not defined a valid supply chain for selected brand(s), so role selection is not allowed.',
                details: {
                  role: selection.role,
                  brands: resolved.brands || []
                }
              });
            }

            const invalidBrandsForRole = (resolved.brands || []).filter((b) => {
              const key = String(b?.normalizedBrand || '');
              const rolesForThisBrand = Array.isArray(resolved.rolesByBrand?.[key])
                ? resolved.rolesByBrand[key]
                : [];
              return !rolesForThisBrand.includes(selection.role);
            });
            if (invalidBrandsForRole.length > 0) {
              return res.status(403).json({
                status: 'error',
                code: 'role_brand_chain_mismatch',
                message:
                  'Selected role does not match admin-defined chain for some brands. Keep brands in separate entries according to their own supply chain.',
                details: {
                  role: selection.role,
                  mismatchedBrands: invalidBrandsForRole
                }
              });
            }
          }

          if (chainPayloadSignature(incomingChain) === chainPayloadSignature(baselineChain)) {
            try {
              await clearPendingChainRequest(req.userId);
            } catch (e) {
              console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
            }
            profileUpdate.supplierRole = incomingChain.supplierRole;
            profileUpdate.brands = incomingChain.brands;
            profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
          } else {
            try {
              await replacePendingChainRequest(req.userId, incomingChain);
            } catch (e) {
              console.error('[Profile] replacePendingChainRequest:', e);
              return res.status(503).json({
                status: 'error',
                code: 'chain_request_table_missing',
                message:
                  'Profile approval workflow is not available. Ask admin to run migration_supplier_chain_profile_requests.sql in Supabase.'
              });
            }
            chainApprovalPending = true;
            profileUpdate.supplierRole = baselineChain.supplierRole;
            profileUpdate.brands = baselineChain.brands;
            profileUpdate.companyInfoEntries = baselineChain.companyInfoEntries;

            try {
              const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
              const { data: adminRows } = await findAdmins(adminEmail, supabase);
              const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
              if (adminIds.length > 0) {
                const supplierName = currentUser.name || 'Supplier';
                const supplierEmail = currentUser.email || '';
                const preview = incomingChain.companyInfoEntries?.length
                  ? incomingChain.companyInfoEntries
                      .map((e) => `${e.role}: ${String(e.brands || '').slice(0, 60)}`)
                      .join('; ')
                  : `${incomingChain.supplierRole || '—'} — brands: ${String(
                      incomingChain.brands || ''
                    ).slice(0, 80)}`;
                const notifications = adminIds.map((adminId) => ({
                  user_id: adminId,
                  type: 'supplier_chain_profile_pending',
                  title: `Supplier chain profile pending: ${supplierName}`,
                  message: `${supplierName} (${supplierEmail}) submitted supply-chain role/brand changes for admin approval. ${preview}`,
                  related_supplier_id: req.userId,
                  metadata: { source: 'supplier_chain_profile_pending', supplierId: req.userId },
                  is_read: false
                }));
                await insertNotifications(notifications, supabase);
              }
            } catch (notifErr) {
              console.error('[Profile] Failed to notify admins (chain pending):', notifErr);
            }
          }
        }
      }

      updateData.profile = profileUpdate;

      Object.keys(updateData).forEach((key) => {
        if (updateData[key] === undefined) {
          delete updateData[key];
        }
      });

      const { data: updatedUser, error: updateError } = await supabase
        .from('users')
        .update(updateData)
        .eq('id', req.userId)
        .select()
        .single();

      if (updateError || !updatedUser) {
        console.error('Update error:', updateError);
        return res.status(400).json({
          status: 'error',
          message: updateError?.message || 'Failed to update profile'
        });
      }

      delete updatedUser.password;

      if (!chainApprovalPending && updatedUser.user_type === 'supplier') {
        const entries = updatedUser.profile?.companyInfoEntries || [];
        const prevEntries = currentProfile.companyInfoEntries || [];
        const prevRole = String(currentProfile.supplierRole || '').trim();
        const newRole = String(updatedUser.profile?.supplierRole || '').trim();
        const entriesChanged =
          prevEntries.length !== entries.length ||
          JSON.stringify(prevEntries.map((e) => ({ r: e.role, b: e.brands, g: e.gstin, c: e.companyName }))) !==
            JSON.stringify(entries.map((e) => ({ r: e.role, b: e.brands, g: e.gstin, c: e.companyName })));
        const singleRoleChanged = newRole && newRole !== prevRole && entries.length === 0;
        if (entriesChanged || singleRoleChanged) {
          const roleLabels = {
            manufacturer: 'Manufacturer (MGF)',
            stockist: 'Stockist',
            regional_distributor: 'Regional distributor',
            local_distributor: 'Local distributor',
            dealer: 'Dealer',
            retailer: 'Retailer'
          };
          const effectiveRole = entries.length > 0 ? entries[0].role : newRole;
          const label = roleLabels[effectiveRole] || effectiveRole;
          const chainHint =
            'Chain order: MGF → Stockist → Regional distributor → Local distributor → Dealer → Retailer.';
          const supplierName = updatedUser.name || 'Supplier';
          const supplierEmail = updatedUser.email || '';
          const supplierCompany = updatedUser.company || profileData.companyName || '—';
          const gstin = updatedUser.profile?.gstin || profileUpdate.gstin || '—';
          let brandsStr = '—';
          if (entries.length > 0) {
            brandsStr = entries
              .map((e) => `${roleLabels[e.role] || e.role}: ${(e.brands || '').slice(0, 80)}`)
              .join('; ');
          } else {
            const brandsRaw = updatedUser.profile?.brands ?? profileUpdate.brands ?? profileData.brands;
            brandsStr =
              typeof brandsRaw === 'string'
                ? brandsRaw
                : Array.isArray(brandsRaw)
                  ? brandsRaw.join(', ')
                  : brandsRaw
                    ? JSON.stringify(brandsRaw)
                    : '—';
          }
          const shortBrands = brandsStr.length > 280 ? `${brandsStr.slice(0, 277)}…` : brandsStr;

          try {
            const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
            const { data: adminRows } = await findAdmins(adminEmail, supabase);

            const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
            if (adminIds.length > 0) {
              const notifications = adminIds.map((adminId) => ({
                user_id: adminId,
                type: 'supplier_edit',
                title:
                  entries.length > 1
                    ? `Supplier profile: ${entries.length} roles (${label}, …)`
                    : `Supplier profile: ${label}`,
                message:
                  `${supplierName} (${supplierEmail}) — ${supplierCompany} has registered in the supply chain as: ${label}. ${chainHint} ` +
                  `GSTIN: ${gstin}. Brands handled: ${shortBrands}.` +
                  (prevRole ? ` (Previous role: ${roleLabels[prevRole] || prevRole}.)` : ''),
                related_supplier_id: updatedUser.id,
                metadata: {
                  source: 'supplier_profile_supply_chain',
                  supplierId: updatedUser.id,
                  supplierName,
                  supplierEmail,
                  supplierCompany,
                  supplierRole: effectiveRole,
                  supplierRoleLabel: label,
                  companyInfoEntries: entries,
                  previousSupplierRole: prevRole || null,
                  gstin: gstin !== '—' ? gstin : null,
                  brands: entries.length > 0 ? entries : profileUpdate.brands
                },
                is_read: false
              }));

              await insertNotifications(notifications, supabase);
              console.log(
                `[Profile] Notified ${notifications.length} admin(s): supplier ${updatedUser.id} role ${newRole}`
              );
            }
          } catch (notifErr) {
            console.error('[Profile] Failed to notify admins about supplier chain role:', notifErr);
          }
        }
      }

      const profile = await createProfileResponse(updatedUser);
      const payload = {
        status: 'success',
        message: chainApprovalPending
          ? 'Your supply-chain role and brand assignment was submitted for admin approval. Until it is approved, your previous approved assignment stays active.'
          : 'Profile updated successfully',
        profile
      };
      if (chainApprovalPending) {
        payload.chainApprovalPending = true;
      }
      return res.json(payload);
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Update profile error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Internal server error'
      });
    }
  });
}
