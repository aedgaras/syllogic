export interface SettingsUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  functionalCurrency: string | null;
  profilePhotoPath: string | null;
}

export interface SettingsCategory {
  id: string;
  userId: string;
  name: string;
  parentId: string | null;
  categoryType: string | null;
  color: string | null;
  icon: string | null;
  description: string | null;
  categorizationInstructions: string | null;
  isSystem: boolean | null;
  hideFromSelection: boolean | null;
  createdAt: Date | null;
}
