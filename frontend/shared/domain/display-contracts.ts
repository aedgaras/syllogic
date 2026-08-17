/** Small, persistence-independent view models shared by unrelated features. */
export interface CategoryDisplay {
  id: string;
  name: string;
  color: string | null;
  icon: string | null;
  categoryType: string | null;
  hideFromSelection: boolean | null;
}

export interface AccountDisplay {
  id: string;
  name: string;
  institution: string | null;
  accountType: string;
}

export interface AccountForFilter {
  id: string;
  name: string;
}

export interface CategoryForFilter {
  id: string;
  name: string;
  color: string | null;
}
