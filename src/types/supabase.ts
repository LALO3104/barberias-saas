export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      appointment_services: {
        Row: {
          appointment_id: string
          commission_rate_bps: number | null
          created_at: string
          duration_minutes: number
          id: string
          position: number
          price_cents: number
          service_id: string
          service_name: string
          tenant_id: string
        }
        Insert: {
          appointment_id: string
          commission_rate_bps?: number | null
          created_at?: string
          duration_minutes: number
          id?: string
          position?: number
          price_cents: number
          service_id: string
          service_name: string
          tenant_id: string
        }
        Update: {
          appointment_id?: string
          commission_rate_bps?: number | null
          created_at?: string
          duration_minutes?: number
          id?: string
          position?: number
          price_cents?: number
          service_id?: string
          service_name?: string
          tenant_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointment_services_appointment_fkey"
            columns: ["tenant_id", "appointment_id"]
            isOneToOne: false
            referencedRelation: "appointments"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "appointment_services_service_fkey"
            columns: ["tenant_id", "service_id"]
            isOneToOne: false
            referencedRelation: "services"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "appointment_services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      appointments: {
        Row: {
          barber_id: string
          cancellation_reason: string | null
          cancelled_at: string | null
          cancelled_by: string | null
          client_id: string
          client_note: string | null
          completed_at: string | null
          created_at: string
          created_by: string | null
          end_at: string
          id: string
          source: Database["public"]["Enums"]["appointment_source"]
          start_at: string
          status: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id: string
          client_note?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          end_at: string
          id?: string
          source: Database["public"]["Enums"]["appointment_source"]
          start_at: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          cancellation_reason?: string | null
          cancelled_at?: string | null
          cancelled_by?: string | null
          client_id?: string
          client_note?: string | null
          completed_at?: string | null
          created_at?: string
          created_by?: string | null
          end_at?: string
          id?: string
          source?: Database["public"]["Enums"]["appointment_source"]
          start_at?: string
          status?: Database["public"]["Enums"]["appointment_status"]
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "appointments_barber_fkey"
            columns: ["tenant_id", "barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "appointments_client_fkey"
            columns: ["tenant_id", "client_id"]
            isOneToOne: false
            referencedRelation: "clients"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "appointments_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_compensation: {
        Row: {
          barber_id: string
          commission_rate_bps: number
          created_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          commission_rate_bps: number
          created_at?: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          commission_rate_bps?: number
          created_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_compensation_barber_fkey"
            columns: ["tenant_id", "barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "barber_compensation_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      barber_working_hours: {
        Row: {
          barber_id: string
          closes_at: string
          created_at: string
          day_of_week: number
          id: string
          opens_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barber_id: string
          closes_at: string
          created_at?: string
          day_of_week: number
          id?: string
          opens_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barber_id?: string
          closes_at?: string
          created_at?: string
          day_of_week?: number
          id?: string
          opens_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "barber_working_hours_barber_fkey"
            columns: ["tenant_id", "barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "barber_working_hours_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      barbers: {
        Row: {
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          photo_url: string | null
          role_title: string | null
          sort_order: number
          tenant_id: string
          updated_at: string
          user_id: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          photo_url?: string | null
          role_title?: string | null
          sort_order?: number
          tenant_id: string
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          photo_url?: string | null
          role_title?: string | null
          sort_order?: number
          tenant_id?: string
          updated_at?: string
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "barbers_member_fkey"
            columns: ["tenant_id", "user_id"]
            isOneToOne: false
            referencedRelation: "tenant_members"
            referencedColumns: ["tenant_id", "user_id"]
          },
          {
            foreignKeyName: "barbers_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      business_hours: {
        Row: {
          closes_at: string
          created_at: string
          day_of_week: number
          id: string
          opens_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          closes_at: string
          created_at?: string
          day_of_week: number
          id?: string
          opens_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          closes_at?: string
          created_at?: string
          day_of_week?: number
          id?: string
          opens_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "business_hours_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      clients: {
        Row: {
          created_at: string
          created_by: string | null
          deleted_at: string | null
          email: string | null
          full_name: string
          id: string
          notes: string | null
          phone: string | null
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          deleted_at?: string | null
          email?: string | null
          full_name?: string
          id?: string
          notes?: string | null
          phone?: string | null
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "clients_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      plans: {
        Row: {
          code: string
          created_at: string
          features: Json
          max_barbers: number | null
          max_members: number | null
          name: string
          updated_at: string
        }
        Insert: {
          code: string
          created_at?: string
          features?: Json
          max_barbers?: number | null
          max_members?: number | null
          name: string
          updated_at?: string
        }
        Update: {
          code?: string
          created_at?: string
          features?: Json
          max_barbers?: number | null
          max_members?: number | null
          name?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_blocks: {
        Row: {
          barber_id: string | null
          created_at: string
          created_by: string | null
          ends_at: string
          id: string
          reason: string | null
          starts_at: string
          tenant_id: string
          updated_at: string
        }
        Insert: {
          barber_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at: string
          id?: string
          reason?: string | null
          starts_at: string
          tenant_id: string
          updated_at?: string
        }
        Update: {
          barber_id?: string | null
          created_at?: string
          created_by?: string | null
          ends_at?: string
          id?: string
          reason?: string | null
          starts_at?: string
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_barber_fkey"
            columns: ["tenant_id", "barber_id"]
            isOneToOne: false
            referencedRelation: "barbers"
            referencedColumns: ["tenant_id", "id"]
          },
          {
            foreignKeyName: "schedule_blocks_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      services: {
        Row: {
          created_at: string
          description: string | null
          duration_minutes: number
          id: string
          is_active: boolean
          name: string
          price_cents: number
          sort_order: number
          tenant_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          duration_minutes: number
          id?: string
          is_active?: boolean
          name: string
          price_cents: number
          sort_order?: number
          tenant_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          duration_minutes?: number
          id?: string
          is_active?: boolean
          name?: string
          price_cents?: number
          sort_order?: number
          tenant_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "services_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenant_members: {
        Row: {
          created_at: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          role: Database["public"]["Enums"]["member_role"]
          tenant_id: string
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          role?: Database["public"]["Enums"]["member_role"]
          tenant_id?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenant_members_tenant_id_fkey"
            columns: ["tenant_id"]
            isOneToOne: false
            referencedRelation: "tenants"
            referencedColumns: ["id"]
          },
        ]
      }
      tenants: {
        Row: {
          address_line: string | null
          city: string | null
          created_at: string
          currency: string
          id: string
          logo_url: string | null
          name: string
          plan_code: string
          postal_code: string | null
          public_phone: string | null
          site_content: Json
          slug: string
          state: string | null
          status: string
          theme: Json
          timezone: string
          updated_at: string
        }
        Insert: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name: string
          plan_code: string
          postal_code?: string | null
          public_phone?: string | null
          site_content?: Json
          slug: string
          state?: string | null
          status?: string
          theme?: Json
          timezone?: string
          updated_at?: string
        }
        Update: {
          address_line?: string | null
          city?: string | null
          created_at?: string
          currency?: string
          id?: string
          logo_url?: string | null
          name?: string
          plan_code?: string
          postal_code?: string | null
          public_phone?: string | null
          site_content?: Json
          slug?: string
          state?: string | null
          status?: string
          theme?: Json
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "tenants_plan_code_fkey"
            columns: ["plan_code"]
            isOneToOne: false
            referencedRelation: "plans"
            referencedColumns: ["code"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      book_appointment: {
        Args: {
          _barber_id: string
          _client_name: string
          _client_note?: string
          _client_phone: string
          _service_id: string
          _slug: string
          _start_at: string
        }
        Returns: Json
      }
      get_available_slots: {
        Args: {
          _barber_id: string
          _service_id: string
          _slug: string
          _target_date: string
        }
        Returns: {
          slot_start: string
        }[]
      }
      get_public_tenant: { Args: { _slug: string }; Returns: Json }
      set_appointment_status: {
        Args: {
          _appointment_id: string
          _new_status: Database["public"]["Enums"]["appointment_status"]
          _reason?: string
        }
        Returns: Json
      }
      set_barber_working_hours: {
        Args: { _barber_id: string; _intervals: Json; _tenant_id: string }
        Returns: undefined
      }
      set_business_hours: {
        Args: { _intervals: Json; _tenant_id: string }
        Returns: undefined
      }
    }
    Enums: {
      appointment_source: "online" | "staff" | "walk_in"
      appointment_status:
        | "pending"
        | "confirmed"
        | "completed"
        | "cancelled"
        | "no_show"
      member_role: "admin" | "barber"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      appointment_source: ["online", "staff", "walk_in"],
      appointment_status: [
        "pending",
        "confirmed",
        "completed",
        "cancelled",
        "no_show",
      ],
      member_role: ["admin", "barber"],
    },
  },
} as const
