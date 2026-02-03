# tsp-form UI Library Guidelines

## Overview
tsp-form is a React UI component library. Always use tsp-form components instead of raw HTML elements when building UI.

## Available Components

### Core Components
- `Button` - Use instead of `<button>`. Props: `color`, `variant`, `size`, `disabled`
- `Input` - Use instead of `<input>`. Props: `startIcon`, `endIcon`, `onEndIconClick`
- `TextArea` - Use instead of `<textarea>`
- `Select` - Dropdown select with search. Props: `options`, `value`, `onChange`, `multiple`, `placeholder`
- `ProgressBar` - Progress indicator. Props: `value`, `showLabel`, `label`, `color`, `size`, `striped`, `animated`

### Layout Components
- `SideMenu` - Side navigation menu
- `CollapsiblePanel` - Expandable panel with title
- `Modal` - Modal dialog
- `PopOver` - Popover/dropdown component

### Form Components
- `LabeledCheckbox` - Checkbox with label
- `RadioGroup` - Radio button group
- `Switch` - Toggle switch
- `Slider` - Range slider
- `NumberSpinner` - Number input with +/- buttons
- `DatePicker` - Date picker
- `InputDatePicker` - Input with date picker popup
- `InputDateRangePicker` - Date range picker input
- `DoubleDatePicker` - Two date pickers side by side
- `FormControlError` - Wrapper to show validation errors

### Utility Components
- `Skeleton` - Loading skeleton
- `Tooltip` - Tooltip on hover
- `Pagination` - Page navigation
- `JsonPretty` - JSON formatter display
- `Carousel` - Image/content carousel

### Context Providers
- `ModalProvider` - Wrap app for modal support
- `SnackbarProvider` - Wrap app for snackbar/toast notifications
- `useSnackbarContext` - Hook to show snackbars: `addSnackbar({ message: 'Hello' })`

## Button Usage

```tsx
import { Button } from 'tsp-form';

// Variants: solid (default), outline, ghost
// Colors: default, primary, secondary, success, warning, danger
// Sizes: sm, md, lg

<Button color="primary" variant="solid" size="md">Submit</Button>
<Button variant="outline" color="secondary">Cancel</Button>
<Button variant="ghost" disabled>Disabled</Button>
```

## Select Usage

```tsx
import { Select } from 'tsp-form';

const options = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
];

<Select
  options={options}
  value={selected}
  onChange={setSelected}
  placeholder="Select fruit"
/>
```

## ProgressBar Usage

```tsx
import { ProgressBar } from 'tsp-form';

// Colors: primary, secondary, success, warning, danger
// Sizes: sm, md, lg

<ProgressBar value={75} showLabel />
<ProgressBar value={50} color="success" striped animated />
<ProgressBar value={60} showLabel label="60 of 100 files" />
```

## Input Usage

```tsx
import { Input } from 'tsp-form';
import { Search, Eye, EyeOff } from 'lucide-react';

<Input placeholder="Search..." startIcon={<Search size={18} />} />
<Input
  type={showPassword ? "text" : "password"}
  endIcon={showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
  onEndIconClick={() => setShowPassword(!showPassword)}
/>
```

## Form with react-hook-form

```tsx
import { useForm, Controller } from 'react-hook-form';
import { Input, Select, Button, FormControlError } from 'tsp-form';

const { register, control, handleSubmit, formState: { errors } } = useForm();

<form onSubmit={handleSubmit(onSubmit)}>
  <FormControlError error={errors.name}>
    <Input {...register("name", { required: "Name is required" })} />
  </FormControlError>

  <Controller
    name="fruit"
    control={control}
    render={({ field: { onChange, value } }) => (
      <Select options={options} value={value} onChange={onChange} />
    )}
  />

  <Button type="submit" color="primary">Submit</Button>
</form>
```

## CSS Classes

Use these Tailwind CSS classes defined in the theme:

### Colors
- `bg-surface`, `bg-surface-hover`, `bg-surface-shallow`, `bg-surface-elevated`
- `bg-primary`, `text-primary-contrast`
- `border-line`
- `text-fg`, `text-control-label`

### Spacing
- `p-card` - Card padding

### Form
- `form-label` - Label styling
- `form-error` - Error message styling
