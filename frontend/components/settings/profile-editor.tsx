"use client";
import { t as translate } from "@/i18n/translate";


import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProfilePhotoUpload } from "@/components/onboarding/profile-photo-upload";
import { updateUserProfile } from "@/lib/actions/settings";
import type { SettingsUser } from "@/features/settings/public";

interface ProfileEditorProps {
  user: SettingsUser;
}

export function ProfileEditor({ user }: ProfileEditorProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [name, setName] = useState(user.name || "");
  const [profilePhoto, setProfilePhoto] = useState<File | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error(translate("pleaseEnterYourName"));
      return;
    }

    setIsLoading(true);

    try {
      const formData = new FormData();
      formData.append("name", name.trim());
      if (profilePhoto) {
        formData.append("profilePhoto", profilePhoto);
      }

      const result = await updateUserProfile(formData);

      if (result.success) {
        toast.success(translate("profileUpdatedSuccessfully"));
        setProfilePhoto(null);
        router.refresh();
      } else {
        toast.error(result.error || translate("failedToUpdateProfile"));
      }
    } catch {
      toast.error(translate("anErrorOccurredPleaseTryAgain"));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{translate("profile")}</CardTitle>
        <CardDescription>
          {translate("updateYourPersonalInformationAndPreferences")}
        </CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-6 pb-6">
          <ProfilePhotoUpload
            value={profilePhoto}
            onChange={setProfilePhoto}
            defaultImage={user.profilePhotoPath || user.image}
            name={name}
          />

          <div className="space-y-2">
            <Label htmlFor="name">{translate("name")}</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={translate("yourNameab4229")}
              className="w-full sm:max-w-xs"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="email">{translate("email84add5")}</Label>
            <Input
              id="email"
              value={user.email}
              disabled
              className="w-full bg-muted sm:max-w-xs"
            />
            <p className="text-xs text-muted-foreground">
              {translate("emailCannotBeChanged")}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="currency">{translate("functionalCurrency")}</Label>
            <Input
              id="currency"
              value={user.functionalCurrency || "EUR"}
              disabled
              className="w-full bg-muted sm:max-w-24"
            />
            <p className="text-xs text-muted-foreground">
              {translate("functionalCurrencyIsSetDuringOnboardingAndCannotBe")}
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button type="submit" disabled={isLoading}>
            {isLoading ? translate("saving") : translate("saveChangesfa2984")}
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}
