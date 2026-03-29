import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

// vi.mock factories are hoisted to the top, so we can't reference variables
// declared in the test file. Instead we define the mock function inside the
// factory and retrieve it via the mocked module after import.
vi.mock('../services/api', () => ({
  authAPI: { login: vi.fn() },
}));

vi.mock('../styles/Auth.css', () => ({}));

vi.mock('lucide-react', () => ({ Eye: () => null }));

const mockNavigate = vi.fn();
vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

// Import after mocks are declared — these get the mocked versions
import { authAPI } from '../services/api';
import Login from '../pages/Login';

// The password input uses bullet placeholder — query it by name attribute
const getPasswordInput = (container) => container.querySelector('[name="password"]');

function renderLogin(onAuthSuccess = vi.fn()) {
  return render(
    <MemoryRouter>
      <Login onAuthSuccess={onAuthSuccess} />
    </MemoryRouter>
  );
}

describe('Login component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders email and password fields', () => {
    const { container } = renderLogin();
    expect(screen.getByPlaceholderText(/email/i)).toBeInTheDocument();
    expect(getPasswordInput(container)).not.toBeNull();
  });

  it('renders a submit button', () => {
    renderLogin();
    expect(screen.getByRole('button', { name: /login/i })).toBeInTheDocument();
  });

  it('shows loading state while submitting', async () => {
    // login never resolves so loading state persists
    authAPI.login.mockReturnValue(new Promise(() => {}));
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'test@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /logging in/i })).toBeInTheDocument();
    });
    expect(screen.getByRole('button', { name: /logging in/i })).toBeDisabled();
  });

  it('navigates to /classrooms on successful login', async () => {
    const user = { id: 'u1', username: 'testuser', email: 'test@example.com' };
    const token = 'fake-jwt-token';
    authAPI.login.mockResolvedValue({ data: { user, token } });
    const onAuthSuccess = vi.fn();

    const { container } = renderLogin(onAuthSuccess);
    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'test@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(onAuthSuccess).toHaveBeenCalledWith(user, token);
      expect(mockNavigate).toHaveBeenCalledWith('/classrooms');
    });
  });

  it('shows generic error message when login fails without specific message', async () => {
    authAPI.login.mockRejectedValue({ response: undefined });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'test@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'wrongpw' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText(/login failed/i)).toBeInTheDocument();
    });
  });

  it('shows "No account found..." error from server response', async () => {
    authAPI.login.mockRejectedValue({
      response: { data: { error: 'No account found with that email or username' } },
    });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'nobody@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'password123' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText('No account found with that email or username')).toBeInTheDocument();
    });
  });

  it('shows "Incorrect password" error from server response', async () => {
    authAPI.login.mockRejectedValue({
      response: { data: { error: 'Incorrect password' } },
    });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'real@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'wrongpw' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
  });

  it('error message persists while user types after a failed login', async () => {
    authAPI.login.mockRejectedValue({
      response: { data: { error: 'Incorrect password' } },
    });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'real@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'wrongpw' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    // Wait for error to appear
    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });

    // Type in the password field — error should NOT disappear
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'newpass' } });
    expect(screen.getByText('Incorrect password')).toBeInTheDocument();
  });

  it('error clears when a new submit begins', async () => {
    // First attempt fails
    authAPI.login.mockRejectedValueOnce({
      response: { data: { error: 'Incorrect password' } },
    });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'real@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'wrongpw' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });

    // Second attempt — login hangs so we can check the cleared error before it resolves
    authAPI.login.mockReturnValue(new Promise(() => {}));
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    // Error is cleared at the start of handleSubmit (setError(''))
    await waitFor(() => {
      expect(screen.queryByText('Incorrect password')).toBeNull();
    });
  });

  it('does not navigate when login fails', async () => {
    authAPI.login.mockRejectedValue({
      response: { data: { error: 'Incorrect password' } },
    });
    const { container } = renderLogin();

    fireEvent.change(screen.getByPlaceholderText(/email/i), { target: { name: 'email', value: 'real@example.com' } });
    fireEvent.change(getPasswordInput(container), { target: { name: 'password', value: 'wrongpw' } });
    fireEvent.click(screen.getByRole('button', { name: /login/i }));

    await waitFor(() => {
      expect(screen.getByText('Incorrect password')).toBeInTheDocument();
    });
    expect(mockNavigate).not.toHaveBeenCalled();
  });
});
