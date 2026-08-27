import { describe, expect, it } from 'vitest';
import {
  DUPLICATE_PROJECT_NAME_MESSAGE,
  projectNameAlreadyExists
} from './projectNameUniqueness';

describe('projectNameAlreadyExists', () => {
  const projects = [
    { groupId: 'g1', boqName: 'Cement' },
    { groupId: 'g2', boqName: 'Site A plumbing' }
  ];

  it('flags a case-insensitive duplicate name', () => {
    expect(projectNameAlreadyExists(projects, 'cement')).toBe(true);
    expect(projectNameAlreadyExists(projects, '  CEMENT  ')).toBe(true);
  });

  it('allows a unique name', () => {
    expect(projectNameAlreadyExists(projects, 'Steel')).toBe(false);
  });

  it('ignores the current project when renaming', () => {
    expect(projectNameAlreadyExists(projects, 'Cement', { excludeId: 'g1' })).toBe(false);
    expect(projectNameAlreadyExists(projects, 'Cement', { excludeId: 'g2' })).toBe(true);
  });

  it('exposes the user-facing validation copy', () => {
    expect(DUPLICATE_PROJECT_NAME_MESSAGE).toBe(
      'Project name already exists. Please enter a different name.'
    );
  });
});
