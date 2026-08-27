import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { useForm } from "react-hook-form";
import { Form, FormControl, FormField, FormItem, FormLabel } from "./form";

function Harness({ required }: { required?: boolean }) {
  const form = useForm({ defaultValues: { identifier: "" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="identifier"
        render={({ field }) => (
          <FormItem>
            <FormLabel required={required}>Identifiant</FormLabel>
            <FormControl>
              <input {...field} />
            </FormControl>
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("shadcn FormLabel required", () => {
  it("renders a red asterisk only when required", () => {
    const { rerender } = render(<Harness required />);
    const mark = screen.getByTestId("required-mark");
    expect(mark).toHaveTextContent("*");
    expect(mark).toHaveClass("text-danger");
    expect(screen.getByText(/Identifiant/)).not.toHaveClass("text-danger");

    rerender(<Harness />);
    expect(screen.queryByTestId("required-mark")).toBeNull();
    expect(screen.getByText("Identifiant").textContent).not.toContain("*");
  });
});
