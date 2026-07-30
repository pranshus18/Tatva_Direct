import { v4 as uuidv4 } from 'uuid';
import { requireAuthentication as authenticateToken } from '../../../middleware/authMiddleware.js';
import { supabase } from '../../../config/supabase.js';
import {
  baselineChainFromProfile,
  buildChainPayloadFromProfileData,
  chainPayloadSignature,
  chainRequiresAdminApproval,
  clearPendingChainRequest,
  detectSupplyChainRoleChanges,
  hasAnySupplyChainRole,
  replacePendingChainRequest
} from '../../../services/supplierChainProfileService.js';
import { buildAdminReviewChainPayload } from '../../../services/supplierChainAdminService.js';
import { insertNotifications } from '../../../repositories/notificationsRepository.js';
import { findAdmins } from '../../../repositories/usersRepository.js';
import { profileUpdateSchema, profileShippingAddressCreateSchema } from '../../../contracts/profileContracts.js';
import {
  isSupplierBranchAddressComplete
} from '../../../services/upstreamOrderInputService.js';
import { getContractErrorMessage, parseWithSchema } from '../../../utils/contractValidation.js';
import {
  resolveCompanyInfoEntriesForValidation,
  supplierProfileIncludesChainDraft,
  validateCompanyInfoEntriesList,
  validateUniqueBrandsAcrossEntries,
  SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE
} from '../../../utils/supplierChainEntryValidation.js';
import {
  createProfileResponse,
  deriveShippingAddressesFromProfile,
  ensureBrandApprovedOrRequest,
  formatShippingAddressDisplayName,
  normalizeShippingAddressEntry,
  parseBrandTokens,
  resolveChainRoleOptionsForBrands,
  shippingAddressEntryFromBranch,
  validateShippingAddressEntries
} from '../profileHelpers.js';
import { syncPmCustomerProfileForUser, resolvePmPortalFlag } from '../../../services/pmUserService.js';
import { isAddressComplete, normalizeAddress } from '../../po/shared/poHelpers.js';

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

      const isServiceProviderUpdate =
        profileData.userType === 'service_provider' || currentUser.user_type === 'service_provider';

      const updateData = {};

      if (!isServiceProviderUpdate) {
        updateData.company = profileData.companyName;
        updateData.phone = profileData.phone;

        if (profileData.contactPerson !== undefined) {
          const nextName = String(profileData.contactPerson || '').trim();
          if (nextName) {
            updateData.name = nextName;
          }
        }

        if (profileData.email !== undefined) {
          const nextEmail = String(profileData.email || '').trim().toLowerCase();
          if (nextEmail && nextEmail !== String(currentUser.email || '').trim().toLowerCase()) {
            const { data: existingEmailUser } = await supabase
              .from('users')
              .select('id')
              .eq('email', nextEmail)
              .maybeSingle();

            if (existingEmailUser && existingEmailUser.id !== currentUser.id) {
              return res.status(400).json({
                status: 'error',
                message: 'This email is already registered to another account'
              });
            }

            updateData.email = nextEmail;
          }
        }
      }

      // Service providers may optionally update users.address when sent; suppliers below.
      if (profileData.address && profileData.userType === 'service_provider') {
        updateData.address = {
          ...(currentUser.address || {}),
          ...profileData.address
        };
      }

      const currentProfile = currentUser.profile || {};
      const profileUpdate = {
        ...currentProfile
      };

      if (!isServiceProviderUpdate) {
        profileUpdate.website = profileData.website;
        profileUpdate.description = profileData.description;
      }

      let chainApprovalPending = false;
      let chainDraftSaved = false;
      let brandApprovalRequested = false;
      let brandApprovalFailures = [];
      let brandAlreadyApproved = false;
      let pmSyncWarning = null;

      if (profileData.userType === 'service_provider') {
        const shippingAddresses = Array.isArray(profileData.shippingAddresses)
          ? profileData.shippingAddresses.map((entry) =>
              normalizeShippingAddressEntry({
                ...entry,
                id: entry.id || uuidv4()
              })
            )
          : [];
        const shippingValidation = validateShippingAddressEntries(shippingAddresses, {
          userType: 'service_provider'
        });
        if (!shippingValidation.ok) {
          return res.status(400).json({
            status: 'error',
            code: shippingValidation.code,
            message: shippingValidation.message
          });
        }
        profileUpdate.shippingAddresses = shippingAddresses;
        delete profileUpdate.billingAddresses;
        delete profileUpdate.gstin;
        delete profileUpdate.panNumber;
        const projects = (profileData.projects || []).map((project) => ({
          ...project,
          id: project.id || uuidv4()
        }));
        profileUpdate.projects = projects;

        if (profileData.pmCustomerAccount) {
          const acct = profileData.pmCustomerAccount;
          const fullName = String(acct.fullName || '').trim();
          const userName = String(acct.userName || '').trim();
          const email = String(acct.email || '').trim().toLowerCase();
          const phoneNumber = String(acct.phoneNumber || currentUser.phone || '')
            .replace(/\D/g, '')
            .slice(-10);

          if (email && email !== String(currentUser.email || '').trim().toLowerCase()) {
            const { data: existingEmailUser } = await supabase
              .from('users')
              .select('id')
              .eq('email', email)
              .maybeSingle();

            if (existingEmailUser && existingEmailUser.id !== currentUser.id) {
              return res.status(400).json({
                status: 'error',
                message: 'This email is already registered to another account'
              });
            }
          }

          if (fullName) {
            updateData.name = fullName;
          }
          if (phoneNumber && phoneNumber.length === 10) {
            updateData.phone = phoneNumber;
          }
          if (email) {
            updateData.email = email;
          }

          profileUpdate.pmCustomerProfile = {
            ...(currentProfile.pmCustomerProfile || {}),
            pmUserId:
              currentProfile.pmCustomerProfile?.pmUserId ||
              currentProfile.pmCustomerAuth?.pmUserId ||
              null,
            fullName: fullName || currentProfile.pmCustomerProfile?.fullName || '',
            userName: userName || currentProfile.pmCustomerProfile?.userName || '',
            email: email || currentProfile.pmCustomerProfile?.email || '',
            phoneNumber: phoneNumber || currentProfile.pmCustomerProfile?.phoneNumber || '',
            status: currentProfile.pmCustomerProfile?.status || 'active',
            isEmailVerified: currentProfile.pmCustomerProfile?.isEmailVerified === true,
            flag: resolvePmPortalFlag(currentUser) || currentProfile.pmCustomerProfile?.flag || ''
          };
        }
      } else if (profileData.userType === 'supplier') {
        const updatingBranches = profileData.branches !== undefined;
        const updatingBillingAddress = profileData.address !== undefined;

        if (updatingBranches) {
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
        }

        if (updatingBillingAddress) {
          const mergedBillingAddress = {
            ...(currentUser.address || {}),
            ...(profileData.address || {})
          };
          const requiredBillingFields = ['line1', 'city', 'state', 'pincode', 'country'];
          const missingBillingField = requiredBillingFields.find(
            (field) => !String(mergedBillingAddress?.[field] || '').trim()
          );
          if (missingBillingField) {
            return res.status(400).json({
              status: 'error',
              code: 'supplier_billing_address_required',
              message: `Registered billing address field "${missingBillingField}" is required.`
            });
          }
          updateData.address = mergedBillingAddress;
          delete profileUpdate.billingAddresses;
        }

        if (profileData.businessType !== undefined) {
          profileUpdate.businessType = profileData.businessType;
        }
        if (profileData.categories !== undefined) {
          profileUpdate.categories = profileData.categories || [];
        }
        if (profileData.gstin !== undefined || profileData.mainGstin !== undefined) {
          profileUpdate.gstin = profileData.gstin || profileData.mainGstin;
        }
        if (profileData.ownershipDetails !== undefined) {
          profileUpdate.ownershipDetails = profileData.ownershipDetails;
        }
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
        const roleChanges = detectSupplyChainRoleChanges(baselineChain, incomingChain);
        const wantsDraftSave = profileData.saveAsDraft === true;
        const wantsBrandApprovalSave = profileData.saveBrandApprovalOnly === true;
        let isIncompleteChainDraft = false;
        const incomingEntries = Array.isArray(incomingChain.companyInfoEntries)
          ? incomingChain.companyInfoEntries
          : [];
        const uniqueBrandsCheck = validateUniqueBrandsAcrossEntries(incomingEntries);
        if (!uniqueBrandsCheck.ok) {
          return res.status(400).json({
            status: 'error',
            code: 'duplicate_brand_entry',
            message: uniqueBrandsCheck.message
          });
        }
        const hasRole =
          incomingEntries.length > 0
            ? incomingEntries.some((e) => String(e?.role || '').trim())
            : hasAnySupplyChainRole(incomingChain);
        const saveSupplyChainEntryId = String(profileData.saveSupplyChainEntryId || '').trim();
        const includesChainUpdateIntent = () =>
          wantsBrandApprovalSave ||
          wantsDraftSave ||
          isIncompleteChainDraft ||
          supplierProfileIncludesChainDraft(profileData);

        if (supplierProfileIncludesChainDraft(profileData) && !wantsBrandApprovalSave) {
          const chainEntriesForValidation = resolveCompanyInfoEntriesForValidation(profileData);
          const entriesToValidate = saveSupplyChainEntryId
            ? chainEntriesForValidation.filter(
                (entry) => String(entry?.id || '').trim() === saveSupplyChainEntryId
              )
            : chainEntriesForValidation;

          if (saveSupplyChainEntryId && entriesToValidate.length === 0) {
            return res.status(400).json({
              status: 'error',
              code: 'supply_chain_entry_not_found',
              message: 'Could not find the supply-chain entry to save.'
            });
          }

          const completeness = validateCompanyInfoEntriesList(entriesToValidate);
          if (!completeness.ok) {
            if (roleChanges.length > 0) {
              return res.status(400).json({
                status: 'error',
                code: 'role_change_requires_complete_entry',
                message:
                  completeness.message ||
                  'Complete all required fields for this brand before submitting a supply-chain role change for admin approval.',
                roleChanges
              });
            }
            if (!wantsDraftSave) {
              return res.status(400).json({
                status: 'error',
                code: 'supply_chain_entry_incomplete',
                message: completeness.message
              });
            }
            isIncompleteChainDraft = true;
            chainDraftSaved = true;
            profileUpdate.chainProfileDraft = incomingChain;
            profileUpdate.chainProfileDraftUpdatedAt = new Date().toISOString();
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

        const collectBrandStringsForSupplyChainGate = (chain, options = {}) => {
          const forceAll = options?.force === true;
          if (forceAll) return collectBrandStringsFromChain(chain);

          const saveEntryId = String(options?.saveSupplyChainEntryId || '').trim();
          const brandStrings = [];
          const entries = Array.isArray(chain.companyInfoEntries) ? chain.companyInfoEntries : [];

          if (entries.length > 0) {
            for (const e of entries) {
              const entryId = String(e?.id || '').trim();
              if (saveEntryId && entryId !== saveEntryId) continue;

              const brandsStr = String(e?.brands || '').trim();
              if (!brandsStr) continue;

              const role = String(e?.role || '').trim();
              if (saveEntryId || role) {
                brandStrings.push(brandsStr);
              }
            }
            return brandStrings;
          }

          if (typeof chain.brands === 'string' && chain.brands.trim()) {
            brandStrings.push(chain.brands);
          }
          return brandStrings;
        };

        const runGlobalBrandGate = async (chain, options = {}) => {
          const force = options?.force === true;
          if (!force && !hasAnySupplyChainRole(chain)) return null;
          const brandStrings = collectBrandStringsForSupplyChainGate(chain, {
            force,
            saveSupplyChainEntryId: options?.saveSupplyChainEntryId || saveSupplyChainEntryId
          });
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
              const submittedAt =
                approval.brand?.requested_at ||
                approval.brand?.updated_at ||
                approval.brand?.created_at ||
                null;
              failures.push({
                brand: b,
                code: approval.code,
                status: approval.brand?.status || null,
                message: approval.message,
                requestedAt: submittedAt,
                submittedAt
              });
            }
          }
          return failures.length > 0 ? failures : null;
        };

        if (includesChainUpdateIntent()) {
          if (wantsBrandApprovalSave || wantsDraftSave) {
            const brandStrings = collectBrandStringsFromChain(incomingChain);
            const uniqueBrands = [
              ...new Set(
                brandStrings
                  .flatMap((s) => parseBrandTokens(s))
                  .map((b) => b.trim())
                  .filter(Boolean)
              )
            ];
            if (uniqueBrands.length === 0) {
              return res.status(400).json({
                status: 'error',
                code: 'brand_required_for_brand_approval',
                message: 'Select at least one brand before saving.'
              });
            }
          }

          if (wantsBrandApprovalSave) {
          profileUpdate.chainProfileDraft = null;
          profileUpdate.chainProfileDraftUpdatedAt = null;
          const brandFailures = await runGlobalBrandGate(incomingChain, { force: true });
          if (brandFailures) {
            const catalogExistsErrors = brandFailures.filter(
              (f) => String(f?.code || '') === 'brand_already_in_approved_catalog'
            );
            if (catalogExistsErrors.length > 0) {
              return res.status(400).json({
                status: 'error',
                code: 'brand_already_in_approved_catalog',
                message:
                  catalogExistsErrors[0]?.message ||
                  'This brand is already in the approved brands list. Choose it from the approved brands list instead of requesting a new brand.',
                brands: catalogExistsErrors
              });
            }
            const expectedApprovalCodes = new Set([
              'brand_approval_required',
              'brand_approval_pending'
            ]);
            const nonApprovalErrors = brandFailures.filter(
              (f) => !expectedApprovalCodes.has(String(f?.code || ''))
            );
            if (nonApprovalErrors.length > 0) {
              return res.status(500).json({
                status: 'error',
                code: 'brand_approval_save_failed',
                message: 'Failed to process one or more brands for approval.',
                brands: nonApprovalErrors
              });
            }
            brandApprovalRequested = true;
            brandApprovalFailures = brandFailures;
          } else {
            brandAlreadyApproved = true;
          }
          try {
            await clearPendingChainRequest(req.userId);
          } catch (e) {
            console.warn('[Profile] clearPendingChainRequest (brand approval save):', e?.message || e);
          }
          profileUpdate.supplierRole = incomingChain.supplierRole;
          profileUpdate.brands = incomingChain.brands;
          profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
        } else if (isIncompleteChainDraft) {
          // Keep approved profile active; store incomplete edits as draft only.
          profileUpdate.supplierRole = baselineChain.supplierRole;
          profileUpdate.brands = baselineChain.brands;
          profileUpdate.companyInfoEntries = baselineChain.companyInfoEntries;
        } else if (!hasRole) {
          profileUpdate.chainProfileDraft = null;
          profileUpdate.chainProfileDraftUpdatedAt = null;
          try {
            await clearPendingChainRequest(req.userId);
          } catch (e) {
            console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
          }
          profileUpdate.supplierRole = incomingChain.supplierRole;
          profileUpdate.brands = incomingChain.brands;
          profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
        } else {
          profileUpdate.chainProfileDraft = null;
          profileUpdate.chainProfileDraftUpdatedAt = null;
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
          const allIncomingEntries = Array.isArray(incomingChain.companyInfoEntries)
            ? incomingChain.companyInfoEntries
            : [];
          const entriesForRoleValidation = saveSupplyChainEntryId
            ? allIncomingEntries.filter(
                (entry) => String(entry?.id || '').trim() === saveSupplyChainEntryId
              )
            : allIncomingEntries.filter((entry) => {
                const brandsStr = String(entry?.brands || '').trim();
                if (!brandsStr) return false;
                const role = String(entry?.role || '').trim();
                if (role) return true;
                return (
                  entry?.supplyChainRegistrationStarted === true ||
                  String(entry?.gstin || '').trim() ||
                  String(entry?.companyName || '').trim() ||
                  (Array.isArray(entry?.authorizationCertificateUrls) &&
                    entry.authorizationCertificateUrls.length > 0) ||
                  String(entry?.authorizationCertificateUrl || '').trim()
                );
              });

          if (saveSupplyChainEntryId && entriesForRoleValidation.length === 0) {
            return res.status(400).json({
              status: 'error',
              code: 'supply_chain_entry_not_found',
              message: 'Could not find the supply-chain entry to save.'
            });
          }

          for (const e of entriesForRoleValidation) {
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
            entriesForRoleValidation.length === 0 &&
            allIncomingEntries.length === 0 &&
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
            entriesForRoleValidation.length === 0 &&
            allIncomingEntries.length === 0 &&
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
                message: SELECT_YOURSELF_ROLE_AND_DOCS_REQUIRED_MESSAGE,
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
              const isBrandNotApproved = resolved.reason === 'brand_not_approved';
              return res.status(403).json({
                status: 'error',
                code: isBrandNotApproved ? 'brand_not_approved_for_supply_chain' : 'supply_chain_not_defined_for_selected_brand',
                message:
                  resolved.message ||
                  (isBrandNotApproved
                    ? 'This brand has not yet been approved by the admin. Please wait until the approval is complete before proceeding.'
                    : 'Admin has not defined a valid supply chain for selected brand(s), so role selection is not allowed.'),
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

          if (chainRequiresAdminApproval(baselineChain, incomingChain)) {
            const reviewPayload = buildAdminReviewChainPayload(baselineChain, incomingChain);
            const reviewEntryCount = Array.isArray(reviewPayload.companyInfoEntries)
              ? reviewPayload.companyInfoEntries.length
              : 0;
            if (reviewEntryCount === 0) {
              return res.status(400).json({
                status: 'error',
                code: 'no_chain_changes_to_review',
                message: 'No supply-chain changes were detected for admin review.'
              });
            }
            try {
              await replacePendingChainRequest(req.userId, reviewPayload);
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

            void (async () => {
              try {
                const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
                const { data: adminRows } = await findAdmins(adminEmail, supabase);
                const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
                if (adminIds.length === 0) return;

                const supplierName = currentUser.name || 'Supplier';
                const supplierEmail = currentUser.email || '';
                const preview = reviewPayload.companyInfoEntries?.length
                  ? reviewPayload.companyInfoEntries
                      .map((e) => `${e.role}: ${String(e.brands || '').slice(0, 60)}`)
                      .join('; ')
                  : `${reviewPayload.supplierRole || '—'} — brands: ${String(reviewPayload.brands || '').slice(0, 80)}`;
                const roleChangePreview =
                  roleChanges.length > 0
                    ? ` Role changes: ${roleChanges
                        .map((change) => `${change.brand || 'Brand'} ${change.fromRole} -> ${change.toRole}`)
                        .join('; ')}.`
                    : '';
                const notifications = adminIds.map((adminId) => ({
                  user_id: adminId,
                  type: 'supplier_chain_profile_pending',
                  title: `Supplier chain profile pending: ${supplierName}`,
                  message: `${supplierName} (${supplierEmail}) submitted supply-chain role/brand changes for admin approval. ${preview}${roleChangePreview}`,
                  related_supplier_id: req.userId,
                  metadata: {
                    source: 'supplier_chain_profile_pending',
                    supplierId: req.userId,
                    roleChanges
                  },
                  is_read: false
                }));
                await insertNotifications(notifications, supabase);
              } catch (notifErr) {
                console.error('[Profile] Failed to notify admins (chain pending):', notifErr);
              }
            })();
          } else {
            try {
              await clearPendingChainRequest(req.userId);
            } catch (e) {
              console.warn('[Profile] clearPendingChainRequest:', e?.message || e);
            }
            profileUpdate.supplierRole = incomingChain.supplierRole;
            profileUpdate.brands = incomingChain.brands;
            profileUpdate.companyInfoEntries = incomingChain.companyInfoEntries;
          }
        }
        }
      }

      const nextName = String(updateData.name || currentUser.name || '').trim();
      const nextEmail = String(updateData.email || currentUser.email || '').trim().toLowerCase();
      const nextCompany = String(updateData.company ?? currentUser.company ?? '').trim();
      const hasRealEmail = nextEmail && !/@phone\.tatvadirect\.local$/i.test(nextEmail);
      if (currentProfile.profileIncomplete === true) {
        if (isServiceProviderUpdate) {
          const pmCustomer = currentProfile.pmCustomerProfile || {};
          const spName = String(pmCustomer.fullName || nextName || '').trim();
          const spEmail = String(pmCustomer.email || nextEmail || '').trim().toLowerCase();
          const spHasRealEmail = spEmail && !/@phone\.tatvadirect\.local$/i.test(spEmail);
          if (spName && spName !== 'User' && spHasRealEmail) {
            profileUpdate.profileIncomplete = false;
          }
        } else if (nextName && nextName !== 'User' && hasRealEmail && nextCompany) {
          profileUpdate.profileIncomplete = false;
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

      let finalUser = updatedUser;
      if (isServiceProviderUpdate) {
        try {
          finalUser = await syncPmCustomerProfileForUser(updatedUser, {
            localCustomerFields: profileData.pmCustomerAccount || null,
            pushLocalFirst: Boolean(profileData.pmCustomerAccount),
            pushIfEstablished: false,
            syncIdentityFromPm: true
          });
        } catch (pmSyncError) {
          console.warn('[Profile] PM customer sync failed:', pmSyncError?.message || pmSyncError);
          pmSyncWarning = pmSyncError?.message || 'Could not sync customer profile with PM platform.';
        }
      }

      if (!chainApprovalPending && finalUser.user_type === 'supplier') {
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

          void (async () => {
            try {
              const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
              const { data: adminRows } = await findAdmins(adminEmail, supabase);
              const adminIds = [...new Set((adminRows || []).map((a) => a.id))];
              if (adminIds.length === 0) return;

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
            } catch (notifErr) {
              console.error('[Profile] Failed to notify admins about supplier chain role:', notifErr);
            }
          })();
        }
      }

      const profile = await createProfileResponse(finalUser);
      const payload = {
        status: 'success',
        message: brandApprovalRequested
          ? 'Brand request submitted for admin approval. It will appear in supplier catalog after admin approval.'
          : brandAlreadyApproved
            ? 'This brand is already approved by admin.'
          : chainApprovalPending
            ? 'Your supply-chain role and brand assignment was submitted for admin approval. Until it is approved, your previous approved assignment stays active.'
            : chainDraftSaved
              ? 'Draft saved. You can return later to complete remaining fields and submit.'
              : pmSyncWarning
                ? `Profile saved locally. ${pmSyncWarning}`
              : 'Profile updated successfully',
        profile
      };
      if (brandApprovalRequested) {
        payload.brandApprovalRequested = true;
      }
      if (brandApprovalFailures.length > 0) {
        payload.brandApprovals = brandApprovalFailures;
      }
      if (brandAlreadyApproved) {
        payload.brandAlreadyApproved = true;
      }
      if (chainApprovalPending) {
        payload.chainApprovalPending = true;
      }
      if (chainDraftSaved) {
        payload.chainDraftSaved = true;
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

  router.post('/shipping-addresses', authenticateToken, async (req, res) => {
    try {
      const payload = parseWithSchema(profileShippingAddressCreateSchema, req.body || {});

      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('*')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      const userType = currentUser.user_type || currentUser.profile?.userType;
      const normalized = normalizeAddress(payload);
      if (!isAddressComplete(normalized)) {
        return res.status(400).json({
          status: 'error',
          message: 'Complete shipping address (street, city, state, PIN, country) is required.'
        });
      }

      const currentProfile = currentUser.profile || {};

      if (userType === 'supplier') {
        const existingBranches = Array.isArray(currentProfile.branches) ? currentProfile.branches : [];
        const newBranch = {
          id: uuidv4(),
          name: String(payload.label || '').trim() || normalized.city || 'Shipping address',
          address: normalized.line1,
          city: normalized.city,
          state: normalized.state,
          zipCode: normalized.pincode,
          country: normalized.country,
          phone: '',
          ...(payload.latitude != null ? { latitude: payload.latitude } : {}),
          ...(payload.longitude != null ? { longitude: payload.longitude } : {}),
          ...(payload.geoLocation ? { geoLocation: payload.geoLocation } : {})
        };
        const nextBranches = [...existingBranches, newBranch];
        for (let i = 0; i < nextBranches.length; i += 1) {
          const branch = nextBranches[i] || {};
          if (!isSupplierBranchAddressComplete(branch)) {
            const label = String(branch?.name || '').trim() || `Branch ${i + 1}`;
            return res.status(400).json({
              status: 'error',
              code: 'supplier_branch_address_incomplete',
              message: `Shipping address "${label}" is missing required fields.`
            });
          }
        }

        const { error: updateError } = await supabase
          .from('users')
          .update({
            profile: {
              ...currentProfile,
              branches: nextBranches
            }
          })
          .eq('id', req.userId);

        if (updateError) throw updateError;

        const savedEntry = shippingAddressEntryFromBranch(newBranch);
        return res.json({
          status: 'success',
          message: 'Shipping address saved to profile',
          shippingAddress: savedEntry,
          shippingAddresses: nextBranches
            .filter((branch) => isSupplierBranchAddressComplete(branch))
            .map((branch) => shippingAddressEntryFromBranch(branch))
        });
      }

      if (userType !== 'service_provider') {
        return res.status(403).json({
          status: 'error',
          message: 'Only service providers and suppliers can save shipping addresses to profile.'
        });
      }

      const existing = Array.isArray(currentProfile.shippingAddresses)
        ? currentProfile.shippingAddresses
        : [];

      const newEntry = normalizeShippingAddressEntry({
        id: uuidv4(),
        label: String(payload.label || '').trim() || normalized.city || 'Shipping address',
        ...normalized,
        ...(payload.latitude != null ? { latitude: payload.latitude } : {}),
        ...(payload.longitude != null ? { longitude: payload.longitude } : {}),
        ...(payload.geoLocation ? { geoLocation: payload.geoLocation } : {})
      });
      newEntry.displayName = formatShippingAddressDisplayName(newEntry, existing.length);

      const nextShippingAddresses = [...existing, newEntry];
      const shippingValidation = validateShippingAddressEntries(nextShippingAddresses, {
        userType: 'service_provider'
      });
      if (!shippingValidation.ok) {
        return res.status(400).json({
          status: 'error',
          code: shippingValidation.code,
          message: shippingValidation.message
        });
      }

      const { error: updateError } = await supabase
        .from('users')
        .update({
          profile: {
            ...currentProfile,
            shippingAddresses: nextShippingAddresses
          }
        })
        .eq('id', req.userId);

      if (updateError) throw updateError;

      return res.json({
        status: 'success',
        message: 'Shipping address saved to profile',
        shippingAddress: newEntry,
        shippingAddresses: nextShippingAddresses
      });
    } catch (error) {
      if (String(error?.name || '') === 'ZodError') {
        return res.status(400).json({ status: 'error', message: getContractErrorMessage(error) });
      }
      console.error('Create profile shipping address error:', error);
      return res.status(500).json({ status: 'error', message: 'Failed to save shipping address' });
    }
  });

  // Supplier asks Admin to configure supply-chain roles for an approved brand (roles are admin-only).
  router.post('/supplier/request-chain-configuration', authenticateToken, async (req, res) => {
    try {
      const brand = String(req.body?.brand || '').trim();
      if (!brand) {
        return res.status(400).json({
          status: 'error',
          message: 'Brand name is required'
        });
      }

      const { data: currentUser, error: fetchError } = await supabase
        .from('users')
        .select('id, name, email, user_type')
        .eq('id', req.userId)
        .single();

      if (fetchError || !currentUser) {
        return res.status(404).json({ status: 'error', message: 'User not found' });
      }

      const userType = String(currentUser.user_type || '').toLowerCase();
      if (userType !== 'supplier') {
        return res.status(403).json({
          status: 'error',
          message: 'Only suppliers can request supply-chain role configuration'
        });
      }

      const adminEmail = process.env.ADMIN_EMAIL || 'admin@tatvadirect.com';
      const { data: adminRows } = await findAdmins(adminEmail, supabase);
      const adminIds = [...new Set((adminRows || []).map((row) => row?.id).filter(Boolean))];
      if (adminIds.length === 0) {
        return res.status(503).json({
          status: 'error',
          message: 'No admin is available to receive this request right now'
        });
      }

      const supplierName = String(currentUser.name || 'Supplier').trim() || 'Supplier';
      const supplierEmail = String(currentUser.email || '').trim();
      const notifications = adminIds.map((adminId) => ({
        user_id: adminId,
        type: 'supplier_chain_configuration_requested',
        title: `Supply-chain roles needed: ${brand}`,
        message: `${supplierName}${supplierEmail ? ` (${supplierEmail})` : ''} requested Admin to configure supply-chain roles for brand "${brand}". Suppliers cannot create roles themselves.`,
        related_supplier_id: req.userId,
        metadata: {
          source: 'supplier_request_chain_configuration',
          supplierId: req.userId,
          brand
        },
        is_read: false
      }));
      await insertNotifications(notifications, supabase);

      return res.json({
        status: 'success',
        message: 'Admin has been notified to configure supply-chain roles for this brand.'
      });
    } catch (error) {
      console.error('request-chain-configuration error:', error);
      return res.status(500).json({
        status: 'error',
        message: 'Failed to notify admin about supply-chain role configuration'
      });
    }
  });
}
