"use client";

import { useRef, useState, type FormEvent } from "react";
import { X } from "lucide-react";
import { AuthField } from "@/components/auth/auth-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";

type PasswordValues = { current: string; next: string; confirm: string };
const emptyValues: PasswordValues = { current: "", next: "", confirm: "" };

export function ChangePasswordDialog() {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<PasswordValues>(emptyValues);
  const [errors, setErrors] = useState<Partial<Record<keyof PasswordValues, string>>>({});
  const [preview, setPreview] = useState(false);
  const currentRef = useRef<HTMLInputElement>(null);
  const nextRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  function changeOpen(next: boolean) {
    setValues(emptyValues); setErrors({}); setPreview(false); setOpen(next);
  }

  function changeField(field: keyof PasswordValues, value: string) {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextErrors: typeof errors = {};
    if (!values.current) nextErrors.current = "Enter your current password.";
    if (values.next.length < 8 || !values.next.trim()) nextErrors.next = "Use at least 8 characters for your new password.";
    else if (values.next === values.current) nextErrors.next = "Choose a different password.";
    if (!values.confirm) nextErrors.confirm = "Confirm your new password.";
    else if (values.confirm !== values.next) nextErrors.confirm = "Passwords don’t match.";
    setErrors(nextErrors);
    if (nextErrors.current) { currentRef.current?.focus(); return; }
    if (nextErrors.next) { nextRef.current?.focus(); return; }
    if (nextErrors.confirm) { confirmRef.current?.focus(); return; }
    setValues(emptyValues);
    setPreview(true);
    requestAnimationFrame(() => closeRef.current?.focus());
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild><Button variant="secondary" className="w-full text-xs sm:w-auto">Change Password</Button></DialogTrigger>
      <DialogContent lang="en" showCloseButton={false} onOpenAutoFocus={(event) => { event.preventDefault(); currentRef.current?.focus(); }} className="data-[state=open]:zoom-in-100 data-[state=closed]:zoom-out-100 sm:max-w-[460px]">
        <DialogClose asChild><Button type="button" variant="ghost" size="icon-sm" aria-label="Close Change Password" className="absolute top-4 right-4 text-muted-foreground"><X className="size-[18px]" strokeWidth={1.6} aria-hidden="true" /></Button></DialogClose>
        <DialogHeader className="pr-6"><DialogTitle>Change Password</DialogTitle><DialogDescription className="pt-1 leading-relaxed">{preview ? "This is a preview of the password change flow." : "Choose a new password for your account."}</DialogDescription></DialogHeader>
        {preview ? <>
          <p role="status" className="rounded-sm bg-background px-4 py-4 text-sm leading-relaxed text-muted-foreground">No password has been changed. Account security is not connected in this demo.</p>
          <DialogClose asChild><Button ref={closeRef} type="button" variant="secondary" className="sm:ml-auto">Close</Button></DialogClose>
        </> : <form noValidate onSubmit={submit} className="mt-1 space-y-5">
          <AuthField ref={currentRef} id="settings-current-password" label="Current Password" type="password" autoComplete="current-password" value={values.current} error={errors.current} onChange={(event) => changeField("current", event.target.value)} />
          <AuthField ref={nextRef} id="settings-new-password" label="New Password" type="password" autoComplete="new-password" value={values.next} error={errors.next} hint={<p className="text-xs text-muted-foreground">Use at least 8 characters.</p>} onChange={(event) => changeField("next", event.target.value)} />
          <AuthField ref={confirmRef} id="settings-confirm-password" label="Confirm Password" type="password" autoComplete="new-password" value={values.confirm} error={errors.confirm} onChange={(event) => changeField("confirm", event.target.value)} />
          <div className="flex flex-col gap-2 pt-1 sm:flex-row-reverse">
            <Button type="submit" className="">Change Password</Button>
            <DialogClose asChild><Button type="button" variant="secondary">Cancel</Button></DialogClose>
          </div>
          <p className="text-center text-[11px] leading-relaxed text-muted-foreground">Demo only. Your password will not be changed or saved.</p>
        </form>}
      </DialogContent>
    </Dialog>
  );
}
